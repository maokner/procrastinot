-- 0003_wallet_auth.sql
--
-- Wallet-first authentication migration.
--
-- Rationale: a user row now exists the moment a wallet signs in for the
-- first time (via SIWE → /api/siwe/verify). The username is chosen on the
-- /onboarding page the next request, so `profiles.username` must be
-- nullable. The citext regex check is kept but relaxed to allow NULL.

-- 1. Drop the existing NOT NULL + regex check on `username`.
alter table public.profiles
  alter column username drop not null;

-- The inline `check (username ~ '^[a-z0-9_]{3,20}$')` constraint was created
-- without an explicit name, so Postgres named it `profiles_username_check`.
-- Drop it if present (idempotent — tolerate either the auto-name or a
-- prior run of this migration).
alter table public.profiles
  drop constraint if exists profiles_username_check;

-- 2. Re-add the regex check, permissive of NULL.
alter table public.profiles
  add constraint profiles_username_check
  check (username is null or username ~ '^[a-z0-9_]{3,20}$');
