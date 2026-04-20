import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { formatUnits, type Hex } from 'viem';
import type { Config } from './config.js';
import { logger } from './logger.js';

/**
 * USDC uses 6 decimals on Sepolia and mainnet. The contract stores stake /
 * oracleFee as uint128 base units; the DB stores them as numeric(20,6).
 * `formatUnits(n, 6)` gives us a canonical decimal string that Postgres
 * accepts directly.
 */
const USDC_DECIMALS = 6;

function fmtUsdc(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

function lc(addr: string): string {
  return addr.toLowerCase();
}

function isoFromSeconds(secs: bigint | number): string {
  return new Date(Number(secs) * 1000).toISOString();
}

export type CommitmentCreatedInput = {
  id: bigint;
  user: `0x${string}`;
  enemy: `0x${string}`;
  stake: bigint;
  oracleFee: bigint;
  deadline: bigint;
  task: string;
  rubric: string;
  txHash: Hex;
  blockTimestamp: bigint; // seconds
};

export type VerdictRequestedInput = {
  id: bigint;
  evidenceURI: string;
  attemptNumber: number;
  txHash: Hex;
  blockNumber: bigint;
  blockTimestamp: bigint;
};

export type VerdictSubmittedInput = {
  id: bigint;
  passed: boolean;
  reasonHash: Hex;
  txHash: Hex;
  blockNumber: bigint;
  blockTimestamp: bigint;
};

export type CompletedInput = {
  id: bigint;
  txHash: Hex;
};

export type ForfeitedInput = {
  id: bigint;
  txHash: Hex;
  blockNumber: bigint;
  blockTimestamp: bigint;
};

export type IndexerDb = {
  getCursor(): Promise<bigint | null>;
  setCursor(block: bigint): Promise<void>;
  upsertCommitmentCreated(ev: CommitmentCreatedInput): Promise<void>;
  updateCommitmentOnVerdictRequested(ev: VerdictRequestedInput): Promise<void>;
  updateCommitmentOnVerdictSubmitted(ev: VerdictSubmittedInput): Promise<void>;
  updateCommitmentOnCompleted(ev: CompletedInput): Promise<void>;
  updateCommitmentOnForfeited(ev: ForfeitedInput): Promise<void>;
  resolveProfileIdByAddress(addr: string): Promise<string | null>;
  reresolveNullProfiles(): Promise<number>;
  client(): SupabaseClient;
};

export function createDb(config: Config): IndexerDb {
  const client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // These are server-to-server calls only.
    global: { headers: { 'X-Client-Info': 'procrastinot-indexer' } },
  });

  // ----- cursor ----------------------------------------------------------
  async function getCursor(): Promise<bigint | null> {
    const { data, error } = await client
      .from('indexer_cursor')
      .select('last_block')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw new Error(`getCursor: ${error.message}`);
    if (!data) return null;
    return BigInt(data.last_block);
  }

  async function setCursor(block: bigint): Promise<void> {
    // Upsert the singleton row (id = 1).
    const { error } = await client
      .from('indexer_cursor')
      .upsert(
        {
          id: 1,
          last_block: Number(block),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      );
    if (error) throw new Error(`setCursor: ${error.message}`);
  }

  // ----- profile resolution ---------------------------------------------
  async function resolveProfileIdByAddress(addr: string): Promise<string | null> {
    const { data, error } = await client
      .from('wallets')
      .select('profile_id')
      .eq('address', lc(addr))
      .maybeSingle();
    if (error) {
      // Not fatal — we can store null and re-resolve later.
      logger.warn({ err: error.message, addr: lc(addr) }, 'db.resolveProfile.error');
      return null;
    }
    return data?.profile_id ?? null;
  }

  /**
   * Periodic re-resolution pass: any commitment with a null creator_profile
   * or enemy_profile gets its wallet re-checked. Handles the race where a
   * commitment is indexed before the user links their wallet.
   *
   * Returns the number of rows whose profile ids were filled in.
   */
  async function reresolveNullProfiles(): Promise<number> {
    let updated = 0;

    // Fetch commitments with at least one null profile id.
    const { data, error } = await client
      .from('commitments')
      .select('id, creator_profile, creator_address, enemy_profile, enemy_address')
      .or('creator_profile.is.null,enemy_profile.is.null')
      .limit(500);
    if (error) {
      logger.warn({ err: error.message }, 'db.reresolve.fetchFailed');
      return 0;
    }
    if (!data || data.length === 0) return 0;

    for (const row of data) {
      const patch: Record<string, unknown> = {};
      if (row.creator_profile === null) {
        const pid = await resolveProfileIdByAddress(row.creator_address);
        if (pid) patch.creator_profile = pid;
      }
      if (row.enemy_profile === null) {
        const pid = await resolveProfileIdByAddress(row.enemy_address);
        if (pid) patch.enemy_profile = pid;
      }
      if (Object.keys(patch).length === 0) continue;
      patch.updated_at = new Date().toISOString();
      const { error: updErr } = await client
        .from('commitments')
        .update(patch)
        .eq('id', row.id);
      if (updErr) {
        logger.warn({ err: updErr.message, id: row.id }, 'db.reresolve.updateFailed');
        continue;
      }
      updated++;
    }
    return updated;
  }

  // ----- idempotent verdict_events insert -------------------------------
  //
  // The 0001_init schema does NOT have a unique index on
  // (commitment_id, kind, tx_hash). Rather than adding one (we're not
  // allowed to touch supabase/), we SELECT-then-INSERT: a tiny race window
  // exists, but the indexer is single-writer so no two concurrent inserts
  // race here in practice.
  async function insertVerdictEventIdempotent(row: {
    commitment_id: bigint;
    kind: 'requested' | 'submitted' | 'forfeited';
    attempt: number | null;
    passed: boolean | null;
    reason_hash: string | null;
    evidence_uri: string | null;
    tx_hash: string;
    block_number: bigint;
    created_at: string;
  }): Promise<void> {
    const { data: existing, error: selErr } = await client
      .from('verdict_events')
      .select('id')
      .eq('commitment_id', Number(row.commitment_id))
      .eq('kind', row.kind)
      .eq('tx_hash', row.tx_hash)
      .limit(1);
    if (selErr) throw new Error(`verdict_events select: ${selErr.message}`);
    if (existing && existing.length > 0) {
      logger.debug(
        { id: row.commitment_id.toString(), kind: row.kind, tx_hash: row.tx_hash },
        'db.verdictEvent.skipDuplicate',
      );
      return;
    }
    const { error } = await client.from('verdict_events').insert({
      commitment_id: Number(row.commitment_id),
      kind: row.kind,
      attempt: row.attempt,
      passed: row.passed,
      reason_hash: row.reason_hash,
      evidence_uri: row.evidence_uri,
      tx_hash: row.tx_hash,
      block_number: Number(row.block_number),
      created_at: row.created_at,
    });
    if (error) throw new Error(`verdict_events insert: ${error.message}`);
  }

  // ----- commitment writes ----------------------------------------------
  async function upsertCommitmentCreated(ev: CommitmentCreatedInput): Promise<void> {
    const [creatorProfile, enemyProfile] = await Promise.all([
      resolveProfileIdByAddress(ev.user),
      resolveProfileIdByAddress(ev.enemy),
    ]);

    const oracleFeeStr = fmtUsdc(ev.oracleFee);
    const row = {
      id: Number(ev.id),
      creator_address: lc(ev.user),
      creator_profile: creatorProfile,
      enemy_address: lc(ev.enemy),
      enemy_profile: enemyProfile,
      task: ev.task,
      rubric: ev.rubric,
      stake: fmtUsdc(ev.stake),
      oracle_fee_init: oracleFeeStr,
      oracle_fee_remain: oracleFeeStr,
      attempts_used: 0,
      deadline: isoFromSeconds(ev.deadline),
      status: 'active' as const,
      tx_hash_created: ev.txHash,
      tx_hash_resolved: null,
      created_at: isoFromSeconds(ev.blockTimestamp),
      updated_at: new Date().toISOString(),
    };

    const { error } = await client
      .from('commitments')
      .upsert(row, { onConflict: 'id' });
    if (error) throw new Error(`upsertCommitment: ${error.message}`);
  }

  /**
   * On VerdictRequested: increment attempts_used to attemptNumber, and
   * decrement oracle_fee_remain by oracle_fee_init / 3 (per-attempt burn).
   *
   * We read the current row, compute the new remain in JS (numeric math on
   * decimal strings via BigInt of micro-USDC), then write back. This is
   * idempotent when the same log is replayed because we derive the new
   * remain from oracle_fee_init and attemptNumber, not from the current
   * oracle_fee_remain.
   */
  async function updateCommitmentOnVerdictRequested(
    ev: VerdictRequestedInput,
  ): Promise<void> {
    const { data, error } = await client
      .from('commitments')
      .select('oracle_fee_init')
      .eq('id', Number(ev.id))
      .maybeSingle();
    if (error) throw new Error(`verdictRequested select: ${error.message}`);
    if (!data) {
      // CommitmentCreated must come first; if not, log and skip — the next
      // tick will re-process the earlier block.
      logger.warn({ id: ev.id.toString() }, 'db.verdictRequested.commitmentMissing');
      return;
    }

    // Convert "X.XXXXXX" -> micro-USDC bigint. `oracle_fee_init` comes from
    // Postgres as a string (numeric). Be defensive: trim and handle integer
    // strings too.
    const initMicro = decimalToMicroUsdc(String(data.oracle_fee_init));
    // Burn per-attempt: init / 3 (rounded down in micro-USDC).
    const perAttempt = initMicro / 3n;
    const attemptsUsed = BigInt(ev.attemptNumber);
    let remainingMicro = initMicro - perAttempt * attemptsUsed;
    if (remainingMicro < 0n) remainingMicro = 0n;
    const remainStr = fmtUsdc(remainingMicro);

    const { error: updErr } = await client
      .from('commitments')
      .update({
        attempts_used: ev.attemptNumber,
        oracle_fee_remain: remainStr,
        updated_at: new Date().toISOString(),
      })
      .eq('id', Number(ev.id));
    if (updErr) throw new Error(`verdictRequested update: ${updErr.message}`);

    await insertVerdictEventIdempotent({
      commitment_id: ev.id,
      kind: 'requested',
      attempt: ev.attemptNumber,
      passed: null,
      reason_hash: null,
      evidence_uri: ev.evidenceURI,
      tx_hash: ev.txHash,
      block_number: ev.blockNumber,
      created_at: isoFromSeconds(ev.blockTimestamp),
    });
  }

  async function updateCommitmentOnVerdictSubmitted(
    ev: VerdictSubmittedInput,
  ): Promise<void> {
    // We deliberately do NOT change commitment.status here. If passed,
    // the contract also emits Completed, which is handled below. If not
    // passed, status stays 'active' until either another attempt succeeds
    // or deadline -> Forfeited. This matches plan.md.
    await insertVerdictEventIdempotent({
      commitment_id: ev.id,
      kind: 'submitted',
      attempt: null,
      passed: ev.passed,
      reason_hash: ev.reasonHash,
      evidence_uri: null,
      tx_hash: ev.txHash,
      block_number: ev.blockNumber,
      created_at: isoFromSeconds(ev.blockTimestamp),
    });
  }

  async function updateCommitmentOnCompleted(ev: CompletedInput): Promise<void> {
    const { error } = await client
      .from('commitments')
      .update({
        status: 'completed',
        oracle_fee_remain: '0.000000',
        tx_hash_resolved: ev.txHash,
        updated_at: new Date().toISOString(),
      })
      .eq('id', Number(ev.id));
    if (error) throw new Error(`completed update: ${error.message}`);
  }

  async function updateCommitmentOnForfeited(ev: ForfeitedInput): Promise<void> {
    const { error } = await client
      .from('commitments')
      .update({
        status: 'forfeited',
        oracle_fee_remain: '0.000000',
        tx_hash_resolved: ev.txHash,
        updated_at: new Date().toISOString(),
      })
      .eq('id', Number(ev.id));
    if (error) throw new Error(`forfeited update: ${error.message}`);

    await insertVerdictEventIdempotent({
      commitment_id: ev.id,
      kind: 'forfeited',
      attempt: null,
      passed: null,
      reason_hash: null,
      evidence_uri: null,
      tx_hash: ev.txHash,
      block_number: ev.blockNumber,
      created_at: isoFromSeconds(ev.blockTimestamp),
    });
  }

  return {
    getCursor,
    setCursor,
    upsertCommitmentCreated,
    updateCommitmentOnVerdictRequested,
    updateCommitmentOnVerdictSubmitted,
    updateCommitmentOnCompleted,
    updateCommitmentOnForfeited,
    resolveProfileIdByAddress,
    reresolveNullProfiles,
    client: () => client,
  };
}

/**
 * Convert a decimal USDC amount string (e.g. "0.100000", "12", "1.5") to
 * an integer count of micro-USDC (1 USDC = 10^6). We only need 6
 * fractional digits; extra digits are truncated, missing digits are padded
 * with zeros.
 */
function decimalToMicroUsdc(s: string): bigint {
  const trimmed = s.trim();
  const neg = trimmed.startsWith('-');
  const body = neg ? trimmed.slice(1) : trimmed;
  const [intPartRaw, fracPartRaw = ''] = body.split('.');
  const intPart = intPartRaw === '' ? '0' : intPartRaw;
  const frac = (fracPartRaw + '000000').slice(0, 6);
  const micro = BigInt(intPart) * 1_000_000n + BigInt(frac || '0');
  return neg ? -micro : micro;
}
