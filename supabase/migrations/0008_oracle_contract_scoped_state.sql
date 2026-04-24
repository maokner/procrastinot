-- Scope oracle daemon state by contract address.
-- Commitment ids restart from 0 on every deployment, so id-only oracle rows can
-- collide with verdicts/tasks from an older contract.

alter table public.oracle_tasks
  add column if not exists contract_address text;

update public.oracle_tasks
   set contract_address = 'legacy'
 where contract_address is null;

alter table public.oracle_tasks
  alter column contract_address set not null;

alter table public.oracle_tasks
  drop constraint if exists oracle_tasks_pkey;

alter table public.oracle_tasks
  add primary key (contract_address, commitment_id);

alter table public.oracle_verdicts
  add column if not exists contract_address text;

update public.oracle_verdicts
   set contract_address = 'legacy'
 where contract_address is null;

alter table public.oracle_verdicts
  alter column contract_address set not null;

alter table public.oracle_verdicts
  drop constraint if exists oracle_verdicts_pkey;

alter table public.oracle_verdicts
  add primary key (contract_address, commitment_id, attempt_number);

drop index if exists public.oracle_verdicts_pending_idx;

create index oracle_verdicts_pending_idx
  on public.oracle_verdicts (contract_address, updated_at)
  where status = 'pending';
