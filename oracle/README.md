# oracle

Long-running Node service that listens for `VerdictRequested` events on the
Procrastinot contract, resolves the evidence URI, asks OpenAI whether the
evidence satisfies the commitment's rubric, and calls `submitVerdict` on-chain.

The service is idempotent: it persists a block-scan cursor and per-attempt
verdict state in SQLite, so it is safe to crash and restart without producing
duplicate verdict submissions.

## Environment

Copy `.env.example` to `.env` and fill in:

| Var | Description |
| --- | --- |
| `RPC_URL` | HTTPS JSON-RPC endpoint (Alchemy/Infura Sepolia). |
| `CHAIN` | `sepolia` or `mainnet`. Defaults to `sepolia`. |
| `ORACLE_PRIVATE_KEY` | 0x-prefixed key for the oracle wallet. Must be the address passed as `_oracle` to the deployed contract. |
| `CONTRACT_ADDRESS` | Deployed Procrastinot contract address. |
| `OPENAI_API_KEY` | OpenAI API key. |
| `OPENAI_MODEL` | Defaults to `gpt-4o-mini`. |
| `DB_PATH` | SQLite path. Defaults to `./oracle.db`. |
| `POLL_INTERVAL_MS` | Tick interval in ms. Defaults to `5000`. |
| `START_BLOCK` | First block to scan on fresh install. Set to the contract's deploy block. |

## Running

From the monorepo root:

```bash
pnpm --filter oracle dev     # tsx watch
pnpm --filter oracle build   # tsc -> dist/
pnpm --filter oracle start   # node dist/index.js
```

Logs are structured JSON on stderr (pino).

## Operator top-up procedure

The oracle wallet pays gas for every `submitVerdict` transaction. Keep it
funded with Sepolia ETH (or mainnet ETH in production).

1. Derive the oracle address from `ORACLE_PRIVATE_KEY` (for example with
   `cast wallet address $ORACLE_PRIVATE_KEY`).
2. Send ETH from your operator faucet/treasury to that address.
3. On Sepolia, 0.05 ETH is enough for hundreds of verdict submissions.
4. Alert threshold: set up monitoring to warn when the oracle balance drops
   below roughly `10 * max_expected_daily_verdicts * average_gas_cost`.

No manual rotation is implemented — if you need to rotate the key, deploy a
fresh contract pointing at the new oracle address (or add a rotation path to
the contract before mainnet).

## Idempotency & failure modes

- Each `(commitment_id, attempt_number)` pair is processed at most once: on
  successful submission the row is marked `submitted`; on any exception in
  the evidence/judge/submit path it is marked `failed` and is **not**
  retried. To re-try a failed attempt, flip the row back to `pending` in
  SQLite manually — the oracle is deliberately conservative here because each
  on-chain attempt has already cost the user a fee.
- Before sending a `submitVerdict` tx the oracle re-reads the on-chain
  commitment. If `status != Active` it marks the row `submitted` with a null
  tx hash and skips (defensive — should be rare).
- If the evidence URI fails to resolve within 10s, the verdict is submitted
  with `passed=false` and reason `"evidence could not be retrieved"`.
