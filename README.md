# Procrastinot

> **Commit. Or pay your enemy.**
>
> An on-chain commitment device. Stake USDC against a self-defined task with a
> deadline. Prove completion via an LLM-judge oracle, and your stake is refunded.
> Miss the deadline, and the stake is sent to a wallet you'd hate losing to
> — your "enemy."

Procrastinot is a trust-minimized, irreversible accountability tool. The whole
product is "I cannot un-commit, even with help" — the contract has no admin
escape hatch for active commitments, and the forfeit path is permissionless.

> **Status:** v1 works end-to-end on **Ethereum Sepolia**. Contract is
> deployed + verified at
> [`0xaE8303EC8465A888E19d4A50f91053831e2269a2`](https://sepolia.etherscan.io/address/0xae8303ec8465a888e19d4a50f91053831e2269a2).
> See [`plan.md`](./plan.md) for the v2 plan: usernames, inbox for enemies,
> zero-knowledge-of-counterparty-wallets, and a proper indexer.

---

## How a single commitment plays out

```
user            contract             oracle            OpenAI         enemy
 │                  │                   │                 │              │
 │─ approve USDC ──▶│                   │                 │              │
 │─ create(task,    │                   │                 │              │
 │   rubric, enemy, │                   │                 │              │
 │   stake, fee,    │                   │                 │              │
 │   deadline) ────▶│ ── holds funds    │                 │              │
 │                  │── Created event ─▶│                 │              │
 │                  │                   │                 │              │
 │─ requestVerdict ▶│                   │                 │              │
 │  (evidence URI)  │── Requested ─────▶│                 │              │
 │                  │                   │── judge ───────▶│              │
 │                  │                   │◀── passed? ─────│              │
 │                  │◀──── submitVerdict ─────            │              │
 │                  │  (passed=true, reason hash)         │              │
 │◀─ stake refund ──│                                     │              │
 │                  │ ... or ... past deadline:           │              │
 │                  │◀── forfeit(id) ─── anyone ─────────▶│              │
 │                  │── stake + fee remainder ───────────────────────────▶│
```

Three possible terminal states:

| State       | Cause                                       | Funds go to                         |
|-------------|---------------------------------------------|-------------------------------------|
| `Completed` | Oracle submitted `passed=true` pre-deadline | User gets stake; operator gets fee  |
| `Forfeited` | Anyone called `forfeit` post-deadline       | Enemy gets stake + unspent fee      |
| `Active`    | Default until resolved                      | Contract escrow                     |

Up to **3 oracle attempts per commitment**; each attempt deducts
`initialOracleFee / 3` from the fee budget and pays it to the operator wallet
immediately (so retries cost something).

---

## Repo layout

```
procrastinot/
├── contracts/          # Foundry: Procrastinot.sol, 18 unit tests, deploy script
├── oracle/             # Node/TS daemon: watches events, asks OpenAI, submits verdicts
├── web/                # Next.js 15 + wagmi: connect / create / submit / forfeit UI
├── packages/abi/       # Shared TypeScript types + compiled ABI (workspace:*)
├── scripts/            # sync-abi.ts (copies Foundry artifact into @procrastinot/abi)
├── plan.md             # Next-iteration plan (Supabase + usernames + inbox)
└── .github/workflows/  # CI: foundry tests + monorepo typecheck
```

---

## Quickstart (local dev against Sepolia)

### Prereqs
- **Node 20+** (v24 works, tested)
- **pnpm 9+** — `npm i -g pnpm`
- **Foundry** — `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- A **Sepolia wallet** funded with ETH (gas) and USDC (stake)
  - ETH: <https://sepoliafaucet.com> or <https://www.alchemy.com/faucets/ethereum-sepolia>
  - USDC: <https://faucet.circle.com> → Ethereum Sepolia
- An **OpenAI API key** — <https://platform.openai.com/api-keys>

### Install + build

```bash
git clone https://github.com/<you>/procrastinot
cd procrastinot
pnpm install
pnpm -r build
cd contracts && forge install && forge test -vvv && cd ..
```

### Fill in your env files

Three `.env` files — all gitignored. Copy each template and paste your secrets
into the copy:

```bash
cp contracts/.env.example  contracts/.env
cp oracle/.env.example     oracle/.env
cp web/.env.example        web/.env.local
```

#### `contracts/.env` — only needed if you want to redeploy
| Var                    | What                                                                 |
|------------------------|----------------------------------------------------------------------|
| `SEPOLIA_RPC_URL`      | Any Sepolia RPC. Alchemy / Infura preferred. Public node works too.  |
| `DEPLOYER_PRIVATE_KEY` | 0x-prefixed. Funds Deploy tx. Needs ~0.01 Sepolia ETH.              |
| `ETHERSCAN_API_KEY`    | From <https://etherscan.io/myapikey>. Required for `--verify`.       |
| `ORACLE_ADDRESS`       | Address that will call `submitVerdict`. Corresponds to the key in `oracle/.env`. |
| `OPERATOR_ADDRESS`     | Receives oracle fees. Can equal `ORACLE_ADDRESS`.                    |

#### `oracle/.env`
| Var                   | What                                                   |
|-----------------------|--------------------------------------------------------|
| `RPC_URL`             | Sepolia RPC URL (same one).                            |
| `ORACLE_PRIVATE_KEY`  | 0x-prefixed. Signs `submitVerdict`. Needs gas ETH.     |
| `CONTRACT_ADDRESS`    | Already set to the deployed v1 contract.               |
| `OPENAI_API_KEY`      | Your OpenAI key. **The service that holds this key must not be publicly reachable** — see §Production below. |
| `OPENAI_MODEL`        | Default `gpt-4o-mini`.                                 |
| `DB_PATH`             | SQLite file for idempotency (dedupe on verdict submit). |
| `POLL_INTERVAL_MS`    | Event-scan frequency. Default 5000 ms.                 |
| `START_BLOCK`         | Block to start scanning from. Default = deploy block.  |

#### `web/.env.local`
All values are public (prefixed `NEXT_PUBLIC_`) — no secrets on the client.
| Var                              | What                                                 |
|----------------------------------|------------------------------------------------------|
| `NEXT_PUBLIC_CONTRACT_ADDRESS`   | Pre-filled with v1 Sepolia address.                  |
| `NEXT_PUBLIC_USDC_ADDRESS`       | Sepolia USDC (Circle).                               |
| `NEXT_PUBLIC_CHAIN_ID`           | `11155111` (Sepolia).                                |
| `NEXT_PUBLIC_RPC_URL`            | Sepolia RPC.                                         |
| `NEXT_PUBLIC_WALLETCONNECT_ID`   | Optional. From <https://cloud.walletconnect.com>. If blank, a public demo id is used — MetaMask works, mobile WalletConnect won't be reliable. |

### Run

Three terminals (or tmux panes):

```bash
# Terminal 1 — web app on http://localhost:3000
pnpm --filter web dev

# Terminal 2 — oracle daemon
pnpm --filter oracle dev

# Terminal 3 — optional: watch oracle logs piped through jq
tail -f oracle/*.log  # the oracle logs to stderr so this is also fine:
pnpm --filter oracle dev 2>&1 | pnpm exec pino-pretty
```

### End-to-end smoke test

1. Open <http://localhost:3000>, click **Connect**, pick your wallet.
2. Click **Create a commitment**. Fill in task, rubric, an enemy address,
   stake (e.g. `0.1` USDC), fee (`0.25`), deadline 5 minutes out.
3. Approve USDC → create (two txs). Lands at `/c/<id>`.
4. Paste evidence → submit (one tx).
5. Within ~30s the oracle picks up the `VerdictRequested` event, asks OpenAI,
   submits the verdict. Status flips to **Completed** and your stake refunds.
6. For the forfeit path: new commitment, 2-min deadline, don't submit evidence,
   wait, click **Forfeit**, enemy's USDC balance goes up.

---

## Trust model

- **Single-signer oracle.** One wallet holds the on-chain authority to call
  `submitVerdict`. If that key is compromised, an attacker can settle any
  `Active` commitment as passed. Mitigations planned (multisig, verifier set,
  ZK-of-LLM) are out of scope for v1.
- **No admin escape hatch.** The owner can rotate the oracle/operator wallets
  (useful if keys leak) but cannot touch funds inside active commitments. The
  point of the product is irreversibility.
- **LLM is the judge.** If the oracle can't retrieve evidence within 10s,
  the judge returns `passed=false` — that attempt costs a fee, but up to two
  more attempts are allowed.
- **Forfeit is permissionless.** Anyone can call `forfeit(id)` post-deadline
  (not just the enemy or the user). The funds always go to the on-chain
  enemy address.

---

## Production deployment

`.env` files are local only. In any deployed environment:

| Target        | Where to put secrets                             |
|---------------|--------------------------------------------------|
| Web (Vercel)  | Project Settings → Environment Variables         |
| Oracle (Fly / Railway / Render / Docker) | Platform env / secret manager |
| CI (GitHub Actions) | Repo Settings → Secrets and variables      |

The only service that ever sees `OPENAI_API_KEY` and `ORACLE_PRIVATE_KEY` is
the oracle process. **Do not** put either into the web app's env — anything
prefixed `NEXT_PUBLIC_` is shipped to the browser. The oracle should run on
a host you control (not on Vercel Edge, not on the browser), talking to the
chain via a private RPC endpoint.

A suggested starting config:
- Web → Vercel (Hobby plan)
- Oracle → Fly.io or Railway, one small container, logs to stderr
- Database (v2) → Supabase
- RPC → Alchemy free tier (300M compute units / month is plenty for a demo)

---

## Running the tests

```bash
# Smart contract: 18 tests, covering happy paths, edge cases, reentrancy, and
# the global accounting invariant.
pnpm test:contracts

# Oracle + web + abi typecheck
pnpm -r build
```

CI (see `.github/workflows/ci.yml`) runs both on every push.

---

## Links

- **Deployed contract (Sepolia):** <https://sepolia.etherscan.io/address/0xae8303ec8465a888e19d4a50f91053831e2269a2>
- **Next-iteration plan:** [`plan.md`](./plan.md)
- **Internal design docs:** `~/.claude/plans/procrastinot/` (not checked in; spec for how v1 was built)
