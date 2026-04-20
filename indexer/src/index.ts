// Procrastinot v2 indexer — Phase 0 stub.
// Agent B will replace this with the real implementation.
//
// Expected behavior (see plan.md, Stream B):
//  1. Load env (RPC_URL, CONTRACT_ADDRESS, START_BLOCK, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
//  2. Initialize viem publicClient + Supabase service-role client.
//  3. On first run, backfill from START_BLOCK to head in BACKFILL_CHUNK-size getLogs windows.
//     For each CommitmentCreated / VerdictRequested / VerdictSubmitted / Completed / Forfeited
//     event, write/upsert into Supabase (commitments + verdict_events).
//  4. After backfill, watchContractEvent (or poll latest) and upsert deltas.
//  5. Resolve creator_profile / enemy_profile by looking up wallets.address in Supabase.
//  6. Persist cursor in indexer_cursor table so restarts don't double-process.

console.log('[indexer] stub — agent B will implement this');
process.exit(0);
