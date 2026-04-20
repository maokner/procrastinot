-- Procrastinot v2 — initial schema + RLS + helper functions.
-- Apply via:  supabase db push   (or paste into SQL Editor in the dashboard)

create extension if not exists citext;
create extension if not exists pgcrypto;

---------------------------------------------------------------------------
-- profiles
---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     citext unique not null
               check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone (even anon) can read the public fields to support @username autocomplete.
create policy profiles_read_public
  on public.profiles for select
  using (true);

-- Only the owner can insert their own row (after auth sign-up).
create policy profiles_insert_self
  on public.profiles for insert
  with check (auth.uid() = id);

-- Only the owner can update their own row.
create policy profiles_update_self
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

---------------------------------------------------------------------------
-- wallets  (exactly one verified wallet per profile)
---------------------------------------------------------------------------
create table public.wallets (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  address     citext not null,
  chain_id    int  not null default 11155111,
  verified_at timestamptz not null default now(),
  unique (profile_id),
  unique (address, chain_id)
);

alter table public.wallets enable row level security;

-- A signed-in user can read only their own wallet rows.
create policy wallets_read_own
  on public.wallets for select
  using (profile_id = auth.uid());

-- Only server routes with service role can insert/update wallets
-- (SIWE verification happens server-side and bypasses RLS with the service
-- role client).  No USER policy for insert/update/delete — they can't bypass it.

---------------------------------------------------------------------------
-- commitments  (denormalized chain state; indexer writes, UI reads)
---------------------------------------------------------------------------
create table public.commitments (
  id                bigint primary key,
  creator_profile   uuid references public.profiles(id),
  creator_address   citext not null,
  enemy_profile     uuid references public.profiles(id),
  enemy_address     citext not null,
  task              text not null,
  rubric            text not null,
  stake             numeric(20,6) not null,
  oracle_fee_init   numeric(20,6) not null,
  oracle_fee_remain numeric(20,6) not null,
  attempts_used     smallint not null default 0,
  deadline          timestamptz not null,
  status            text not null
                    check (status in ('active','completed','forfeited')),
  tx_hash_created   text not null,
  tx_hash_resolved  text,
  created_at        timestamptz not null,
  updated_at        timestamptz not null default now()
);

create index commitments_enemy_profile_idx on public.commitments(enemy_profile);
create index commitments_creator_profile_idx on public.commitments(creator_profile);
create index commitments_status_deadline_idx on public.commitments(status, deadline);

alter table public.commitments enable row level security;

-- Only visible to the creator or the enemy.
create policy commitments_read_participants
  on public.commitments for select
  using (creator_profile = auth.uid() or enemy_profile = auth.uid());

-- All writes come from the indexer via service role. No user-level policies.

---------------------------------------------------------------------------
-- verdict_events  (audit log: requested / submitted / forfeited)
---------------------------------------------------------------------------
create table public.verdict_events (
  id              bigserial primary key,
  commitment_id   bigint references public.commitments(id) on delete cascade,
  kind            text not null
                  check (kind in ('requested','submitted','forfeited')),
  attempt         smallint,
  passed          boolean,
  reason_hash     text,
  evidence_uri    text,
  tx_hash         text not null,
  block_number    bigint not null,
  created_at      timestamptz not null
);

create index verdict_events_commitment_idx on public.verdict_events(commitment_id);

alter table public.verdict_events enable row level security;

-- Visible via the parent commitment's participants.
create policy verdict_events_read_via_commitment
  on public.verdict_events for select
  using (
    exists (
      select 1 from public.commitments c
      where c.id = verdict_events.commitment_id
        and (c.creator_profile = auth.uid() or c.enemy_profile = auth.uid())
    )
  );

---------------------------------------------------------------------------
-- indexer_cursor  (block-number bookmark for the indexer)
---------------------------------------------------------------------------
create table public.indexer_cursor (
  id             int primary key default 1,
  last_block     bigint not null,
  updated_at     timestamptz not null default now(),
  check (id = 1)   -- singleton
);

alter table public.indexer_cursor enable row level security;
-- No user-level policies — only the service role client touches this.

---------------------------------------------------------------------------
-- resolve_username  — used by the web app to look up the wallet address
-- behind a @username, without exposing the wallets table directly.
---------------------------------------------------------------------------
create or replace function public.resolve_username(u citext)
  returns table(address citext, chain_id int)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select w.address, w.chain_id
  from public.wallets w
  join public.profiles p on p.id = w.profile_id
  where p.username = u
  limit 1;
$$;

grant execute on function public.resolve_username(citext) to anon, authenticated;

---------------------------------------------------------------------------
-- search_usernames  — prefix search for the @username autocomplete.
--                    Returns public fields only; no wallet data leaks.
---------------------------------------------------------------------------
create or replace function public.search_usernames(q citext, lim int default 8)
  returns table(username citext, display_name text, avatar_url text)
  language sql
  stable
  security definer
  set search_path = public
as $$
  select p.username, p.display_name, p.avatar_url
  from public.profiles p
  join public.wallets w on w.profile_id = p.id  -- must have linked wallet
  where p.username like (q || '%')
  order by p.username
  limit least(lim, 25);
$$;

grant execute on function public.search_usernames(citext, int) to anon, authenticated;
