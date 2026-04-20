# Deployment

Three services; three deploy targets.

| Service  | What it does                                    | Where it belongs                              |
|----------|-------------------------------------------------|-----------------------------------------------|
| `web/`   | Next.js UI, Server Components, API routes       | **Vercel** (or any Node host)                 |
| `indexer/` | Long-running daemon, chain → Supabase mirror  | Railway / a VPS — **not** Vercel              |
| `oracle/`  | Long-running daemon, judges evidence + signs   | Railway / a VPS — **not** Vercel              |

Vercel is for the web app only. The two daemons must run on a platform that
supports long-lived processes. Both daemons are stateless (all persistence
lives in Supabase), so any host that can keep a Node process running will
do. The quickest path: leave the daemons running locally (or any always-on
machine) while the web is on Vercel. Everyone connects to the same Supabase
project, so the system works end-to-end.

---

## Secrets inventory

| Secret                       | Holder(s)                  | Notes                                              |
|------------------------------|----------------------------|----------------------------------------------------|
| `DEPLOYER_PRIVATE_KEY`       | Your laptop (deploy only)  | Never goes to any host. Used once, to deploy.      |
| `ORACLE_PRIVATE_KEY`         | Oracle host only           | Signs `submitVerdict` on-chain.                    |
| `OPENAI_API_KEY`             | Oracle host only           | Never touches the web app.                         |
| `SUPABASE_SERVICE_ROLE_KEY`  | Indexer + Oracle + Vercel (server) | Bypasses RLS. Vercel stores as a non-public env. |
| `SUPABASE_ANON_KEY`          | Web (public)               | Safe to ship to the browser; RLS enforces access.  |
| `ETHERSCAN_API_KEY`          | Your laptop (deploy only)  | Only for `--verify`.                               |

**Nothing secret ever ships in a `NEXT_PUBLIC_*` env var.** Only the contract
address, RPC URL, Supabase URL, and anon key are public.

---

## Deploy the web app to Vercel

### 1. Push the repo to GitHub (already done).

### 2. Create the Vercel project

1. <https://vercel.com/new>
2. Pick the `maokner/procrastinot` repo.
3. **Leave the root directory as `.` (repo root).** The bundled `vercel.json`
   instructs Vercel how to build the monorepo.
4. Framework preset: Next.js (auto-detected).
5. Click **Environment Variables** and add the entries from the list below.
6. Deploy.

### 3. Environment variables on Vercel

Add each of these under **Project Settings → Environment Variables**. Mark
anything NOT starting with `NEXT_PUBLIC_` as an **Encrypted** value (Vercel's
default for server-only vars).

| Name                            | Value                                                     | Scope                |
|---------------------------------|-----------------------------------------------------------|----------------------|
| `NEXT_PUBLIC_CONTRACT_ADDRESS`  | `0x25DF2268051203cf73beb8cD9Cd55c313370FB26`              | Production + Preview |
| `NEXT_PUBLIC_USDC_ADDRESS`      | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`              | all                  |
| `NEXT_PUBLIC_CHAIN_ID`          | `11155111`                                                | all                  |
| `NEXT_PUBLIC_RPC_URL`           | an Alchemy/Infura Sepolia URL (recommended; public nodes are flaky) | all                  |
| `NEXT_PUBLIC_WALLETCONNECT_ID`  | optional — <https://cloud.walletconnect.com>              | all                  |
| `NEXT_PUBLIC_SUPABASE_URL`      | your Supabase project URL                                 | all                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase `anon` key                                  | all                  |
| `SUPABASE_SERVICE_ROLE_KEY`     | your Supabase `service_role` key — **not** NEXT_PUBLIC_    | **server-only**      |

### 4. Add Vercel's deploy URL to Supabase's redirect allowlist

Supabase Auth's email verification links need to know where to redirect
after clicking. In Supabase dashboard → **Authentication → URL Configuration**:

- Site URL: `https://<your-vercel-url>.vercel.app`
- Additional redirect URLs: `https://<your-vercel-url>.vercel.app/**`

If you later add a custom domain, repeat this step for the custom domain.

### 5. SIWE domain binding

The SIWE verifier checks that the signed message's domain matches the
request host. Nothing to do here — `web/app/api/siwe/verify/route.ts`
derives the domain from the incoming request, so it works automatically
on both Vercel and localhost.

---

## Run the oracle + indexer

For a demo, the simplest option is to keep them running on your laptop or
any always-on machine:

```bash
# terminal 1
pnpm --filter indexer dev

# terminal 2
pnpm --filter oracle dev
```

They read from `indexer/.env` and `oracle/.env` respectively — those files
stay local and are never pushed.

When you're ready to host them properly:

### Option A: Railway (recommended)

Railway auto-deploys on `git push` to the tracked branch, supports
Dockerfile-per-service, and builds from the monorepo root. Neither daemon
needs a volume — oracle state lives in Supabase (`oracle_cursor`,
`oracle_tasks`, `oracle_verdicts` tables from migration `0002_oracle_state.sql`).

**One-time setup:**

1. <https://railway.app> → **New Project → Deploy from GitHub repo** → pick
   `procrastinot`.
2. Inside the project, create **two services** (each wired to the same
   repo). Name them `procrastinot-indexer` and `procrastinot-oracle`.
3. For each service, open **Settings → Source** and set:
   - **Root Directory**: `/` (repo root — the Dockerfiles reach into
     `packages/abi` and `pnpm-workspace.yaml`).
   - **Dockerfile Path**: `indexer/Dockerfile` for the indexer service;
     `oracle/Dockerfile` for the oracle service.
   - **Watch Paths** (optional, avoids redeploying on unrelated changes):
     - indexer: `indexer/**, packages/abi/**, pnpm-lock.yaml, pnpm-workspace.yaml`
     - oracle:  `oracle/**, packages/abi/**, pnpm-lock.yaml, pnpm-workspace.yaml`

**Environment variables (Railway → each service → Variables):**

Indexer:

```
RPC_URL=<Alchemy or Infura Sepolia URL>
SUPABASE_URL=<your Supabase URL>
SUPABASE_SERVICE_ROLE_KEY=<your service-role key>
CONTRACT_ADDRESS=0x25DF2268051203cf73beb8cD9Cd55c313370FB26
START_BLOCK=<deploy block of the contract>
# optional: CHAIN, POLL_INTERVAL_MS, BACKFILL_CHUNK
```

Oracle:

```
RPC_URL=<Alchemy or Infura Sepolia URL>
ORACLE_PRIVATE_KEY=<oracle signer key, funded with Sepolia ETH>
OPENAI_API_KEY=<your OpenAI key>
SUPABASE_URL=<your Supabase URL>
SUPABASE_SERVICE_ROLE_KEY=<your service-role key>
CONTRACT_ADDRESS=0x25DF2268051203cf73beb8cD9Cd55c313370FB26
START_BLOCK=<deploy block of the contract>
# optional: CHAIN, POLL_INTERVAL_MS, OPENAI_MODEL
```

**Volumes:** none. Both daemons are stateless.

**Deploy:** Railway triggers a build automatically on the next push. Watch
the service logs:

- Indexer: `poller.start`, `backfill.done`, `poll.tick`
- Oracle: `poll.tick`, and eventually a `submitVerdict` tx hash

Once both services are green, kill any local daemons (`pkill -f "tsx watch"`).

**Redeploys:** automatic on `git push`. Restart a service manually from
the Railway dashboard if needed.

### Option B: A VPS

`systemd` unit files, `docker-compose up -d`, or `pm2 start`. Any process
supervisor works.

---

## First-deploy checklist

- [ ] Supabase migrations applied in order: `supabase/migrations/0001_init.sql` then `supabase/migrations/0002_oracle_state.sql`, both run in the Supabase SQL editor.
- [ ] Supabase Auth → URL Configuration updated with the Vercel URL.
- [ ] Vercel env vars added (eight total; one marked server-only).
- [ ] `RPC_URL` in web + indexer + oracle upgraded from the public node to Alchemy / Infura.
- [ ] Oracle wallet funded with Sepolia ETH (gas for `submitVerdict`).
- [ ] Oracle + indexer running somewhere (local is fine for demo).
- [ ] You can visit the Vercel URL, sign up, link a wallet via SIWE, create a commitment, and see it appear in Postgres (indexer working) and eventually get judged (oracle working).

---

## Rotating a leaked secret

If any secret leaks (git push, screenshare, screenshot):

- `SUPABASE_SERVICE_ROLE_KEY`: Dashboard → Settings → API → **Reset service role key**. Then update on Vercel + indexer host + oracle host.
- `ORACLE_PRIVATE_KEY`: transfer any remaining ETH out of the old address, generate a fresh keypair, update `oracle/.env`, then call `setOracle(newAddress)` on the contract as the owner.
- `OPENAI_API_KEY`: revoke at <https://platform.openai.com/api-keys>, mint a new one, update oracle host.
- `DEPLOYER_PRIVATE_KEY`: only used at deploy time, but if it leaks, move your ETH out.
