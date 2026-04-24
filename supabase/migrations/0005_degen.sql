-- Degen Mode: vault-backed playing balances and Plinko audit trail.

CREATE TABLE degen_balances (
  user_id        UUID    PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  balance_usdc   BIGINT  NOT NULL DEFAULT 0 CHECK (balance_usdc >= 0),
  deposited_usdc BIGINT  NOT NULL DEFAULT 0 CHECK (deposited_usdc >= 0),
  drop_count     INTEGER NOT NULL DEFAULT 0 CHECK (drop_count >= 0),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE plinko_drops (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ball_value_usdc  BIGINT  NOT NULL CHECK (ball_value_usdc > 0),
  rows             INTEGER NOT NULL CHECK (rows IN (8, 12, 16)),
  slot             INTEGER NOT NULL CHECK (slot >= 0),
  path             TEXT    NOT NULL,
  multiplier       NUMERIC(8,4) NOT NULL,
  payout_usdc      BIGINT  NOT NULL CHECK (payout_usdc >= 0),
  balance_before   BIGINT  NOT NULL CHECK (balance_before >= 0),
  balance_after    BIGINT  NOT NULL CHECK (balance_after >= 0),
  server_seed      TEXT    NOT NULL,
  server_seed_hash TEXT    NOT NULL,
  client_seed      TEXT    NOT NULL,
  nonce            BIGINT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX plinko_drops_user_created ON plinko_drops (user_id, created_at DESC);

CREATE TABLE degen_sessions (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID    NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  wallet_address    TEXT    NOT NULL,
  commitment_id     BIGINT  NOT NULL UNIQUE,
  deposited_usdc    BIGINT  NOT NULL CHECK (deposited_usdc > 0),
  deposit_tx_hash   TEXT    NOT NULL,
  deposited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cashed_out_usdc   BIGINT,
  cashout_tx_hash   TEXT,
  cashed_out_at     TIMESTAMPTZ
);

ALTER TABLE degen_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE plinko_drops ENABLE ROW LEVEL SECURITY;
ALTER TABLE degen_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE degen_balances REPLICA IDENTITY FULL;
ALTER TABLE plinko_drops REPLICA IDENTITY FULL;

CREATE POLICY "user reads own balance"
  ON degen_balances FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user reads own drops"
  ON plinko_drops FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user reads own sessions"
  ON degen_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION credit_degen_balance(
  p_user_id UUID,
  p_amount_usdc BIGINT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_amount_usdc <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  INSERT INTO degen_balances (user_id, balance_usdc, deposited_usdc)
  VALUES (p_user_id, p_amount_usdc, p_amount_usdc)
  ON CONFLICT (user_id) DO UPDATE
    SET balance_usdc = degen_balances.balance_usdc + EXCLUDED.balance_usdc,
        deposited_usdc = degen_balances.deposited_usdc + EXCLUDED.deposited_usdc,
        updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION record_degen_deposit(
  p_user_id UUID,
  p_wallet_address TEXT,
  p_commitment_id BIGINT,
  p_deposited_usdc BIGINT,
  p_deposit_tx_hash TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_session_id UUID;
BEGIN
  INSERT INTO degen_sessions (
    user_id,
    wallet_address,
    commitment_id,
    deposited_usdc,
    deposit_tx_hash
  ) VALUES (
    p_user_id,
    p_wallet_address,
    p_commitment_id,
    p_deposited_usdc,
    p_deposit_tx_hash
  )
  ON CONFLICT (commitment_id) DO NOTHING
  RETURNING id INTO v_session_id;

  IF v_session_id IS NULL THEN
    RETURN FALSE;
  END IF;

  PERFORM credit_degen_balance(p_user_id, p_deposited_usdc);
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION process_plinko_drop(
  p_user_id UUID,
  p_ball_value_usdc BIGINT,
  p_rows INTEGER,
  p_slot INTEGER,
  p_path TEXT,
  p_multiplier NUMERIC,
  p_payout_usdc BIGINT,
  p_server_seed TEXT,
  p_server_seed_hash TEXT,
  p_client_seed TEXT,
  p_nonce BIGINT
) RETURNS TABLE(
  drop_id UUID,
  balance_before BIGINT,
  balance_after BIGINT,
  new_drop_count INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance_before BIGINT;
  v_balance_after BIGINT;
  v_drop_count INTEGER;
  v_drop_id UUID;
BEGIN
  SELECT balance_usdc, drop_count
    INTO v_balance_before, v_drop_count
    FROM degen_balances
   WHERE user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_balance'
      USING HINT = 'User has no active degen balance';
  END IF;

  IF v_balance_before < p_ball_value_usdc THEN
    RAISE EXCEPTION 'insufficient_balance'
      USING HINT = 'Balance too low for this bet';
  END IF;

  v_balance_after := v_balance_before + (p_payout_usdc - p_ball_value_usdc);

  UPDATE degen_balances
     SET balance_usdc = v_balance_after,
         drop_count = v_drop_count + 1,
         updated_at = NOW()
   WHERE user_id = p_user_id;

  INSERT INTO plinko_drops (
    user_id,
    ball_value_usdc,
    rows,
    slot,
    path,
    multiplier,
    payout_usdc,
    balance_before,
    balance_after,
    server_seed,
    server_seed_hash,
    client_seed,
    nonce
  ) VALUES (
    p_user_id,
    p_ball_value_usdc,
    p_rows,
    p_slot,
    p_path,
    p_multiplier,
    p_payout_usdc,
    v_balance_before,
    v_balance_after,
    p_server_seed,
    p_server_seed_hash,
    p_client_seed,
    p_nonce
  ) RETURNING id INTO v_drop_id;

  RETURN QUERY SELECT v_drop_id, v_balance_before, v_balance_after, v_drop_count + 1;
END;
$$;

REVOKE ALL ON FUNCTION credit_degen_balance(UUID, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION record_degen_deposit(UUID, TEXT, BIGINT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION process_plinko_drop(UUID, BIGINT, INTEGER, INTEGER, TEXT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION credit_degen_balance(UUID, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION record_degen_deposit(UUID, TEXT, BIGINT, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION process_plinko_drop(UUID, BIGINT, INTEGER, INTEGER, TEXT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) TO service_role;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE degen_balances;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE plinko_drops;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN NULL;
END;
$$;
