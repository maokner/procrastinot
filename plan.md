# Procrastinot v2 — parallelizable build plan

This supersedes the narrative plan that lived here previously. v2 fixes three
v1 rough edges:

1. You shouldn't need to know your enemy's wallet — `@oliver` should resolve.
2. The enemy should be notified and have a one-click claim button, not watch
   the chain for a commitment they never knew about.
3. The web app reads the chain directly on every page load. Has to go.

Plus one product tweak that v1 got slightly wrong: **the unspent oracle fee
on forfeit should stay with the operator, not be forwarded to the enemy.**
That's a smart-contract change — new v2 deploy, v1 stays live for history.

---

## Confirmed decisions (v1 → v2)

- **Strict matching.** Enemies must already be signed up and have a verified
  wallet. No invite-pending flow in v2.
- **One wallet per profile.** Simpler UX, simpler RLS.
- **Oracle and indexer split into separate processes.** Independent crash /
  restart behavior; different scaling needs.
- **Supabase built-in SMTP** for auth emails + "you've been named" notifications.
- **Stay on Sepolia.** No mainnet concerns.
- **API keys never touch the browser.** Web only gets `NEXT_PUBLIC_*` + the
  Supabase anon key. `OPENAI_API_KEY`, `ORACLE_PRIVATE_KEY`, and
  `SUPABASE_SERVICE_ROLE_KEY` live only on server hosts (oracle, indexer,
  web server routes).
- **Fee semantics change on `forfeit`:** stake → enemy; unspent oracleFee →
  operator. (Was: stake + unspent fee → enemy.) Contract redeploy required.

---

## Stack

| Layer            | Tool                                | Notes                               |
|------------------|-------------------------------------|-------------------------------------|
| Accounts + auth  | Supabase Auth (email/password)      | Built-in SMTP for verification.     |
| Database         | Supabase Postgres + RLS             | See schema below.                   |
| Realtime UI      | Supabase Realtime                   | `/inbox` updates live.              |
| Wallet linkage   | SIWE (`siwe` npm pkg)               | Verified in a Next route handler.   |
| Indexer          | New `indexer/` workspace (viem + Supabase service client) | Watches chain events, writes to DB. |
| Oracle           | Existing `oracle/`                  | Unchanged aside from new contract address. |
| Smart contract   | v2 Procrastinot.sol                 | New deploy; v1 stays live for history. |
| Web              | Existing `web/` + heavy rewrite     | React Server Components, lean connect button, Supabase reads. |
| Emails           | Supabase built-in SMTP              | Auth flows + notification templates. |
| Hosting (prod)   | Vercel (web) + Fly/Railway (oracle + indexer) + Supabase cloud | |

---

## Performance budget (the "much faster" requirement)

v1 first-load JS was ~320 KB with three network round-trips before the UI
became interactive (RPC for commitment read, RPC for logs, WalletConnect
relay). v2 targets:

| Metric                         | v1 baseline | v2 target |
|--------------------------------|-------------|-----------|
| `/` first-load JS              | ~320 KB     | ≤ 150 KB  |
| `/my` time-to-data             | ~3–6 s      | ≤ 300 ms  |
| `/c/[id]` time-to-data         | ~1–3 s      | ≤ 200 ms  |
| `/inbox` live update lag       | n/a         | ≤ 1 s     |

Levers:
1. **Replace RainbowKit's 150 KB bundle** with a lean connect button using
   wagmi connectors directly (`injected`, `walletConnect`, `coinbaseWallet`).
   Lazy-load WalletConnect behind a click.
2. **React Server Components for reads.** `/my`, `/c/[id]`, `/inbox` read
   Supabase server-side, ship HTML only.
3. **Kill all `useReadContract` polling** in read paths. Chain is slow; DB is fast.
4. **Supabase Realtime** replaces "poll getCommitment every 5s".
5. **Drop SSR of wallet providers** — render client-only behind a mount flag.
6. **Next.js defaults**: prefetch-on-hover, font optimization, image optimization.

---

## Data model

```sql
-- Public profiles. One per Supabase auth user.
create extension if not exists citext;
create extension if not exists pgcrypto;

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     citext unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- Exactly one verified wallet per profile.
create table wallets (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  address     citext not null,
  chain_id    int  not null default 11155111,
  verified_at timestamptz not null default now(),
  unique (profile_id),
  unique (address, chain_id)
);

-- Denormalized chain state. Indexer owns writes; UI reads.
create table commitments (
  id                bigint primary key,
  creator_profile   uuid references profiles(id),
  creator_address   citext not null,
  enemy_profile     uuid references profiles(id),
  enemy_address     citext not null,
  task              text not null,
  rubric            text not null,
  stake             numeric(20,6) not null,
  oracle_fee_init   numeric(20,6) not null,
  oracle_fee_remain numeric(20,6) not null,
  attempts_used     smallint not null default 0,
  deadline          timestamptz not null,
  status            text not null check (status in ('active','completed','forfeited')),
  tx_hash_created   text not null,
  tx_hash_resolved  text,
  created_at        timestamptz not null,
  updated_at        timestamptz not null default now()
);
create index commitments_enemy_profile_idx on commitments(enemy_profile);
create index commitments_creator_profile_idx on commitments(creator_profile);
create index commitments_status_deadline_idx on commitments(status, deadline);

-- One row per requestVerdict / submitVerdict / forfeit event.
create table verdict_events (
  id              bigserial primary key,
  commitment_id   bigint references commitments(id) on delete cascade,
  kind            text not null check (kind in ('requested','submitted','forfeited')),
  attempt         smallint,
  passed          boolean,
  reason_hash     text,
  evidence_uri    text,
  tx_hash         text not null,
  block_number    bigint not null,
  created_at      timestamptz not null
);
create index verdict_events_commitment_idx on verdict_events(commitment_id);

-- Username → address resolution (SECURITY DEFINER). Returns only what's needed.
create function public.resolve_username(u citext)
  returns table(address citext, chain_id int)
  language sql stable security definer set search_path = public as $$
  select w.address, w.chain_id
  from wallets w
  join profiles p on p.id = w.profile_id
  where p.username = u
  limit 1;
$$;
```

### RLS

| Table            | Anon SELECT  | User SELECT                                       | Writes                |
|------------------|--------------|---------------------------------------------------|-----------------------|
| `profiles`       | `(username, display_name, avatar_url)` only | same                | Owner only            |
| `wallets`        | none         | Own row only                                      | Owner + SIWE-verified |
| `commitments`    | none         | Rows where I'm creator_profile OR enemy_profile   | Indexer (service role) |
| `verdict_events` | none         | Via join on visible commitments                   | Indexer (service role) |

---

## Parallel dispatch

Four streams. **Phase 0** scaffolding (orchestrator writes) produces the
interface contract every agent depends on. Then A/B/C/D run concurrently.

### Phase 0 — orchestrator (before agent dispatch)

- `supabase/migrations/0001_init.sql` — schema + RLS + `resolve_username`
- `web/lib/supabase.ts` — `supabaseBrowser()`, `supabaseServer()` (cookie-based RLS session), `supabaseService()` (service role, server-only)
- `web/lib/db-types.ts` — generated TS types matching the schema (manual for now; `supabase gen types` later)
- `web/app/providers.tsx` — wagmi + react-query + Supabase session provider
- `.env.example` updates in `oracle/`, `web/`, new `indexer/.env.example`
- `indexer/` empty workspace shell (`package.json`, `tsconfig.json`, `src/index.ts` stub)
- Update root `package.json` scripts (`dev:indexer`, `db:migrate`)
- Update `pnpm-workspace.yaml` to include `indexer`

### Stream A — Contracts v2 (running now)

**Owns:** `contracts/`, `packages/abi/src/addresses.ts`, oracle+web env updates for the new address, README status line.

**Delivers:** contract change + updated tests, v2 deploy on Sepolia, refreshed ABI + address exports, live envs pointing at v2.

**Blocks:** nothing (fully parallelizable with B/C/D). Stream D prefers the new address before final integration but can develop against v1 in the interim.

### Stream B — Indexer

**Owns:** `indexer/` (entire workspace), `supabase/migrations/0002_*.sql` if needed for indexer-specific bookkeeping (cursor table).

**Delivers:**
- `indexer/src/index.ts` — entrypoint, config load, Supabase service client init, start poller.
- `indexer/src/poller.ts` — viem `watchContractEvent` for `CommitmentCreated`, `VerdictRequested`, `VerdictSubmitted`, `Completed`, `Forfeited`. Backfill from deploy block using `getLogs` in chunks of 5k blocks. Persists cursor in DB.
- `indexer/src/enrichment.ts` — given `creator_address` / `enemy_address`, look up `profile_id` via `wallets` table; leave null if unknown.
- `indexer/src/db.ts` — prepared statements for upserts.
- `indexer/Dockerfile`
- `indexer/README.md`

**Depends on:** Supabase project created + migration applied + service role key.

### Stream C — Auth, SIWE, Onboarding

**Owns** (files Agent C creates/edits):
- `web/app/signup/page.tsx`
- `web/app/login/page.tsx`
- `web/app/onboarding/page.tsx` (pick @username, then link wallet)
- `web/app/settings/page.tsx`
- `web/app/profile/[username]/page.tsx` (public profile, minimal)
- `web/app/api/siwe/nonce/route.ts`
- `web/app/api/siwe/verify/route.ts`
- `web/app/api/auth/signout/route.ts`
- `web/components/auth/*`
- `web/components/UserMenu.tsx` (avatar dropdown, signout)
- `web/middleware.ts` (gate `/my`, `/inbox`, `/create` behind auth)

**Depends on:** Phase 0 shared libs, Supabase keys.

### Stream D — Commitment UI + perf rewrite

**Owns** (files Agent D creates/edits):
- `web/app/page.tsx` (landing; update copy)
- `web/app/create/page.tsx` (with @username autocomplete)
- `web/app/my/page.tsx` (Server Component, Supabase read, fast)
- `web/app/c/[id]/page.tsx` (Server Component for initial paint, Client Component for live status)
- `web/app/inbox/page.tsx` (NEW — enemy view, realtime)
- `web/app/api/users/search/route.ts`
- `web/components/commitment/*`
- `web/components/ConnectButton.tsx` (NEW — lean, replaces RainbowKit)
- Remove direct RainbowKit imports from the app (keep as dependency only if used transitively).
- `web/lib/commitments.ts` (server-side read helpers)

**Depends on:** Phase 0 shared libs, Supabase keys, eventually Stream A's new contract address.

---

## Security invariants (same as v1, spelled out)

- `SUPABASE_SERVICE_ROLE_KEY` lives only on: indexer host, Next.js server routes that need admin writes. Never in `NEXT_PUBLIC_*`.
- `OPENAI_API_KEY` lives only on the oracle.
- `ORACLE_PRIVATE_KEY` lives only on the oracle.
- The web app only ever receives: `NEXT_PUBLIC_CONTRACT_ADDRESS`, `NEXT_PUBLIC_USDC_ADDRESS`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_WALLETCONNECT_ID`.
- SIWE message carries a server-issued nonce bound to the Supabase session; nonce is single-use.
- The indexer is a strict read-follower. If compromised, an attacker can corrupt Postgres (restoreable from Supabase backups) but cannot move USDC.

---

## Done criteria for v2

- New contract deployed on Sepolia, verified, `PROCRASTINOT_SEPOLIA_V1`
  preserved in `addresses.ts`.
- `forge test -vvv` green including a new test covering the fee split.
- Supabase project live, migrations applied, RLS enforced.
- Indexer is backfilled from deploy block and continues following head.
- Two users (creator + enemy) can each sign up, pick a username, link a
  wallet via SIWE, and see each other by `@username`.
- Creator picks enemy via autocomplete; commitment creates with the
  resolved address; enemy sees it in `/inbox` via realtime within ~1s.
- Past deadline, enemy clicks Claim and receives exactly `stake` USDC
  (no oracle fee forwarded).
- Lighthouse performance score ≥ 90 on `/my` and `/inbox` on a cold load.
