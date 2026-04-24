# Indexer

A long-running Node service that mirrors Procrastinot contract events into
Supabase Postgres so the web UI can read from the database instead of the
chain.

The indexer is a strict **read-follower**. It holds the Supabase
service-role key but no chain-signing key — if compromised, an attacker
can corrupt Postgres (restoreable from Supabase backups) but cannot move
USDC.

## Environment variables

All are required unless noted. See `.env.example` for defaults.

| Name | Purpose |
| --- | --- |
| `RPC_URL` | Sepolia JSON-RPC endpoint. |
| `CHAIN` | `sepolia` or `mainnet`. Defaults to `sepolia`. |
| `CONTRACT_ADDRESS` | Procrastinot contract on the target chain. |
| `START_BLOCK` | Block to begin backfill from on first run. Use the deploy block. |
| `POLL_INTERVAL_MS` | Steady-state poll cadence in ms. `5000` is fine on Sepolia. |
| `BACKFILL_CHUNK` | `getLogs` window size in blocks. Public RPCs cap at ~5000. |
| `SUPABASE_URL` | e.g. `https://<project>.supabase.co`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only.** Never expose to any browser. |
| `LOG_LEVEL` | Optional. pino level (`debug`, `info`, `warn`, `error`). Defaults to `info`. |

## Running locally

From the repo root:

```bash
# One-time: ensure the Supabase schema is applied (see supabase/migrations/).
# Then:
pnpm --filter @procrastinot/abi build   # if not already built
pnpm --filter indexer dev
```

Expected log sequence on a fresh DB:

1. `poller.start` — printed with non-secret config.
2. `poller.cursor.seeded` — first run writes `START_BLOCK - 1` to
   `indexer_cursor`.
3. `backfill.start` → `backfill.chunk` (repeated) → `backfill.done`.
4. `poller.commitmentCreated`, `poller.verdictRequested`, etc. as the
   corresponding logs are encountered in each chunk.
5. Steady state: a quiet `poll.tick` (debug level) every
   `POLL_INTERVAL_MS`.

## Production

```bash
pnpm --filter indexer build
node indexer/dist/index.js
```

Or build and run the supplied `Dockerfile`:

```bash
docker build -f indexer/Dockerfile -t procrastinot-indexer .
docker run --rm --env-file indexer/.env procrastinot-indexer
```

## Idempotency & crash recovery

* **Cursor discipline.** The cursor is written *after* a chunk is fully
  processed. A crash mid-chunk means the chunk will be re-processed on
  restart — which is safe.
* **`commitments` upsert.** Keyed by contract address and commitment id.
  Replay of the same `CommitmentCreated` log overwrites the same row.
* **`verdict_events` inserts.** Before inserting, the indexer SELECTs by
  `(commitment_id, kind, tx_hash)` and skips if present. (The schema
  does not have a unique index for this; we intentionally avoid adding
  one because the indexer is the sole writer.)
* **Profile resolution.** `creator_profile` / `enemy_profile` are
  resolved against `wallets.address` at write time. If a wallet is not
  yet linked, they are written as `null` and a periodic re-resolution
  pass (~60s cadence) fills them in later. This is required for the
  web app's RLS to see the row.

## Reset procedure

Full re-index (nukes all indexed data and rescans from `START_BLOCK`):

```sql
-- Run in Supabase SQL Editor (or via psql with the service role).
truncate public.verdict_events restart identity;
truncate public.commitments    cascade;
delete from public.indexer_cursor;
```

Then restart the indexer (`pnpm --filter indexer dev`). It will seed a
new cursor and backfill from scratch.

### Partial rewind

To re-process only the last N blocks without wiping committed rows,
update the cursor:

```sql
update public.indexer_cursor set last_block = <block> where id = 1;
```

All upserts are idempotent, so the worst case is a little wasted RPC
and DB work.
