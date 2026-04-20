# Procrastinot v2 — Usernames, Inbox, Indexer

This is the plan for the next iteration. v1 (the current deploy on Sepolia)
works end-to-end but has three rough edges we want to fix:

1. **You have to know your enemy's wallet address.** You shouldn't — you
   should just type `@oliver` and have the app resolve it.
2. **The enemy doesn't know they're owed money** unless they're watching the
   chain, and then they have to call `forfeit` themselves from an address
   they know happens to be the enemy of some commitment. No discovery.
3. **Every page reads the chain directly** (`getLogs`, `useReadContract` on a
   public RPC). This is slow and gets slower with more commitments.

v2 fixes all three with a backend layer: **Supabase** for auth + DB, a new
**indexer** service that mirrors chain events into Postgres, and a small
**/inbox** UI for enemies. The smart contract does **not** change — funds
custody stays fully on-chain and the semantics are identical.

---

## Guiding principles

- **Chain remains the source of truth for funds.** The backend never has
  custody of USDC. If Supabase goes down, nothing is lost — the contract can
  still be interacted with directly via Etherscan.
- **Backend is a read cache + directory.** Postgres denormalizes chain events
  for fast reads. The usernames table maps `@oliver → 0x…` (for outbound
  addressing) and `0x… → @oliver` (for the inbox).
- **Auth is proof-of-control, not just email.** Linking a wallet to a
  `@username` requires a **SIWE** signature, so `@oliver` can only be claimed
  by someone who actually controls the wallet.
- **No API keys in the browser.** All writes go through server routes or
  direct contract calls. `OPENAI_API_KEY`, service-role DB keys, and oracle
  private keys only ever live on server hosts (Vercel env, Fly secrets).

---

## Confirmed decisions

- **Strict enemy matching.** You can only create a commitment against a
  user who has already signed up AND verified a wallet. No invite flow in v2.
- **One wallet per profile.** Simpler UX, simpler RLS. Can be relaxed later.
- **Oracle and indexer split into two processes.** Cleaner ops (independent
  crash/restart, different scaling needs) and avoids coupling the idempotency
  DB of the oracle with the read-cache tables.
- **Supabase built-in email** for auth + notifications. Upgrade to Resend
  only if deliverability becomes a problem.
- **Stay on Sepolia.** No mainnet concerns for v2.

---

## Proposed stack

| Layer            | Tool                              | Notes                                              |
|------------------|-----------------------------------|----------------------------------------------------|
| Accounts + auth  | Supabase Auth (email/password)    | Email verification enabled; magic links optional. |
| Database         | Supabase Postgres + RLS           | `profiles`, `wallets`, `commitments`, `verdict_events`. |
| Realtime UI      | Supabase Realtime                 | Enemy's `/inbox` updates without refresh when a new commitment is indexed. |
| Wallet linkage   | SIWE (Sign-In with Ethereum)      | `siwe` npm pkg, verified in a Next.js route handler. |
| Indexer          | New `indexer/` workspace          | viem `watchContractEvent` → Supabase writes. Service-role client. |
| Oracle           | Unchanged (existing `oracle/`)    | Still the signer for `submitVerdict`. Unaware of Supabase. |
| Smart contract   | Unchanged                         | v1 deploy stays live.                              |
| Web              | Existing `web/` + new server routes | Reads via Supabase JS client (RLS enforced).     |
| Emails           | Supabase built-in SMTP            | New-commitment + deadline-passed notifications.    |
| Hosting          | Vercel (web), Fly or Railway (oracle + indexer), Supabase cloud | Budget: $0–20/mo demo tier. |

---

## Data model

```sql
-- Public profiles: one per Supabase auth user.
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     citext unique not null check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  avatar_url   text,
  created_at   timestamptz default now()
);

-- Exactly one verified wallet per profile (enforced via partial unique index).
create table wallets (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  address     citext not null,
  chain_id    int  not null default 11155111,
  verified_at timestamptz not null default now(),
  unique (profile_id)                       -- one wallet per profile
);
create unique index wallets_address_chain_uniq on wallets(address, chain_id);

-- Denormalized chain state. Indexer owns writes; UI reads.
create table commitments (
  id                bigint primary key,     -- matches on-chain id
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
```

### Row-Level Security

| Table            | Anon SELECT            | User SELECT                              | Writes                 |
|------------------|------------------------|------------------------------------------|------------------------|
| `profiles`       | `(username, display_name, avatar_url)` only | same                     | Owner only             |
| `wallets`        | none                   | Own row only                             | Owner + SIWE-verified  |
| `commitments`    | none                   | Rows where I'm creator_profile OR enemy_profile | Indexer (service role) |
| `verdict_events` | none                   | Via join on visible commitments          | Indexer (service role) |

Username → wallet resolution goes through a `public.resolve_username(username)`
SQL function (SECURITY DEFINER) that returns only the verified address — never
the `wallets.id` or timestamps.

---

## Three new flows

### 1. Onboarding
1. `POST /auth/sign-up` (Supabase) with email + password.
2. Email verification lands user on `/onboarding`.
3. User picks a `@username` (regex enforced, uniqueness enforced by DB).
4. **Link wallet**:
   - Click Connect → wallet opens.
   - Client requests a nonce from `/api/siwe/nonce`.
   - Wallet signs a SIWE message containing the nonce.
   - Client posts `{message, signature}` to `/api/siwe/verify`.
   - Server verifies, inserts into `wallets`.

### 2. Create a commitment
1. `/create` has an enemy field with `@username` autocomplete.
2. Autocomplete queries `/api/users/search?q=oli` (rate-limited).
3. On select, UI shows `@oliver (0xC2…71dD)` and disables free text.
4. Submit → approve USDC → create (same two-tx flow as v1).
5. Indexer picks up the `CommitmentCreated` event → writes a row → Oliver's
   realtime channel receives it → Oliver's `/inbox` updates instantly.
6. Supabase email fires to Oliver: "You've been named in a commitment."

### 3. Enemy claim (the whole point)
1. Oliver logs in, lands on `/inbox`.
2. Sees a list of commitments where he's the enemy, with countdowns.
3. Deadline passes → row flips from "waiting" to a green **Claim 1.25 USDC** button.
4. Click → wallet signs `forfeit(id)` → tx sends → funds land in Oliver's wallet.
5. Indexer picks up the `Forfeited` event → status flips to `forfeited` →
   the row disappears from the Active tab and shows in History.

If Oliver never claims, v1 semantics still hold: anyone can forfeit. We can
optionally add a **keeper** (bot that auto-forfeits past-deadline commitments
where the enemy has been inactive for >24h) — nice-to-have, not in v2 MVP.

---

## Key security invariants

- **No private key leaves the server.** `ORACLE_PRIVATE_KEY` lives only on
  the oracle host. `SUPABASE_SERVICE_ROLE_KEY` lives only on the indexer and
  web server. `OPENAI_API_KEY` lives only on the oracle.
- **Web app only sees `NEXT_PUBLIC_*` values + the Supabase anon key.** The
  anon key is safe to expose because every table has RLS.
- **SIWE message includes a server-issued nonce bound to the user's Supabase
  session.** Stops replay + cross-account substitution.
- **Indexer is a read-follower.** It never signs a chain tx. If compromised,
  an attacker can write garbage into Postgres but cannot move funds.

---

## Milestones

| #  | Deliverable                                                           | Effort |
|----|-----------------------------------------------------------------------|--------|
| 1  | Supabase project + schema migration (`supabase/migrations/0001_*.sql`) + RLS policies + seed script | 0.5d |
| 2  | `indexer/` workspace: viem watchContractEvent + Supabase service client; backfill from deploy block; docker | 0.5d |
| 3  | Auth: email sign-up, email verification, `@username` picker page | 0.5d |
| 4  | SIWE wallet linking (Next route handlers + client flow) | 0.5d |
| 5  | Rewrite `/my` + `/c/[id]` to read from Supabase (kills `getLogs` latency) | 0.5d |
| 6  | Username autocomplete in `/create` + address resolution | 0.25d |
| 7  | `/inbox` page: realtime list, countdowns, Claim button | 0.5d |
| 8  | Supabase email notifications on `CommitmentCreated` + near-deadline + Forfeited | 0.25d |
| 9  | Ops: Vercel + Fly deploy configs, secrets setup, one-page ops runbook | 0.25d |

**Total ~3.5 days.** Milestones 1 & 2 unblock almost everything; can be done
first in parallel.

---

## Things we're explicitly not doing in v2

- Multi-chain support. Sepolia only.
- Mainnet USDC. Still the Circle Sepolia faucet.
- Multisig / committee oracle. Single signer stays.
- Custody-based accounts (where the backend holds funds). We never want this.
- Mobile apps. Responsive web only.
- Keeper bot for auto-forfeit. Will revisit if manual claim proves annoying.
- Social graph / public profiles / leaderboards. Just the minimum for the core loop.

---

## Immediate next step

Before writing code: create the Supabase project, get the **project ref**,
**anon key**, and **service-role key**, and drop them into `.env.example`
files as commented templates. Then Milestone 1 can start.
