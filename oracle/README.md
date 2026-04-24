# Oracle

Long-running Node service for Procrastinot.

The oracle watches the Procrastinot contract, caches task metadata, evaluates
evidence with OpenAI, writes verdict state to Supabase, and submits on-chain
settlement transactions when needed.

## Behavior

- `VerdictRequested` events are indexed into `oracle_verdicts`.
- Failed verdicts are submitted on-chain so the commitment can retry or later
  forfeit.
- Passing verdicts are recorded in Supabase first. The user then chooses
  Withdraw or Degen Mode from the web app.
- Withdraw calls `submitVerdict(..., true)`.
- Degen Mode calls `submitVerdictToVault(...)` and records a playing balance.
- Vault cashout calls `releaseFor(...)`, topping up the vault from the oracle
  wallet if needed.

## Environment

| Var | Description |
| --- | --- |
| `RPC_URL` | JSON-RPC endpoint. |
| `CHAIN` | `sepolia` or `mainnet`. Defaults to `sepolia`. |
| `ORACLE_PRIVATE_KEY` | Server-only key for oracle contract writes. |
| `CONTRACT_ADDRESS` | Procrastinot contract address. |
| `DEGEN_VAULT_ADDRESS` | DegenVault contract address. |
| `OPENAI_API_KEY` | Server-only OpenAI API key. |
| `OPENAI_MODEL` | Defaults to the configured lightweight model. |
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role key. |
| `START_BLOCK` | Contract deploy block for first scan. |
| `POLL_INTERVAL_MS` | Poll cadence in milliseconds. |
| `SCAN_CHUNK_BLOCKS` | `getLogs` chunk size. |
| `ORACLE_API_PORT` | HTTP API port. |

## Running

```bash
pnpm --filter oracle dev
pnpm --filter oracle build
pnpm --filter oracle start
```

## Operations

- Keep the oracle wallet funded with gas ETH.
- Keep the oracle wallet funded with USDC if Degen Mode payouts can exceed
  vault deposits.
- Rotate contract addresses and `START_BLOCK` after every deployment.
- Never expose `ORACLE_PRIVATE_KEY`, `OPENAI_API_KEY`, or
  `SUPABASE_SERVICE_ROLE_KEY` to the browser.
