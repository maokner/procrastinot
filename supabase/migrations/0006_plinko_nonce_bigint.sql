-- Fix Plinko nonce storage: Date.now() exceeds Postgres INTEGER range.

ALTER TABLE plinko_drops
  ALTER COLUMN nonce TYPE BIGINT;

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

REVOKE ALL ON FUNCTION process_plinko_drop(UUID, BIGINT, INTEGER, INTEGER, TEXT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_plinko_drop(UUID, BIGINT, INTEGER, INTEGER, TEXT, NUMERIC, BIGINT, TEXT, TEXT, TEXT, BIGINT) TO service_role;
