-- Procrastinot v2 — oracle daemon state (replaces local SQLite).
-- Apply via:  paste into SQL Editor in the dashboard  (same as 0001_init.sql)
--
-- These tables are touched only by the oracle's service-role client. No
-- user-level policies: RLS is on, and the absence of a policy is the policy.

---------------------------------------------------------------------------
-- oracle_cursor  (block-number bookmark for the oracle's event scan)
--
-- Singleton keyed by text (matches the previous SQLite shape, which kept a
-- kv store keyed by 'last_block'; we leave it generalized so future keys
-- can be added without another migration).
---------------------------------------------------------------------------
create table public.oracle_cursor (
  key        text primary key,
  value      bigint not null,
  updated_at timestamptz not null default now()
);

alter table public.oracle_cursor enable row level security;

---------------------------------------------------------------------------
-- oracle_tasks  (task/rubric cache keyed by commitment id)
--
-- The on-chain contract stores only taskHash; the oracle caches the
-- plaintext from the CommitmentCreated event so the judge can evaluate
-- without re-fetching.
---------------------------------------------------------------------------
create table public.oracle_tasks (
  commitment_id text primary key,
  task          text not null,
  rubric        text not null,
  created_at    timestamptz not null default now()
);

alter table public.oracle_tasks enable row level security;

---------------------------------------------------------------------------
-- oracle_verdicts  (lifecycle state for each verdict attempt)
---------------------------------------------------------------------------
create table public.oracle_verdicts (
  commitment_id  text not null,
  attempt_number int  not null,
  status         text not null check (status in ('pending','submitted','failed')),
  passed         boolean,
  reason         text,
  tx_hash        text,
  evidence_uri   text,
  updated_at     timestamptz not null default now(),
  primary key (commitment_id, attempt_number)
);

alter table public.oracle_verdicts enable row level security;

-- Hot path: getPendingVerdicts() runs every poll tick.
create index oracle_verdicts_pending_idx
  on public.oracle_verdicts (updated_at)
  where status = 'pending';
