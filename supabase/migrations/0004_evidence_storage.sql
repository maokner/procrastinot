-- Procrastinot v2 — evidence image storage.
--
-- Apply via: paste into the Supabase SQL Editor (same as prior migrations).
-- Verify in the Supabase dashboard → Storage that the `evidence` bucket exists
-- and is marked Public.
--
-- The bucket stores phone-photo evidence + a small JSON manifest per attempt.
-- Paths are namespaced by profile so one user cannot overwrite another's
-- uploads. Reads are open (public bucket) so the oracle + any commitment page
-- can fetch via plain HTTPS without needing a signed URL.

-- 1. Create the bucket. Idempotent: safe to re-run.
insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', true)
on conflict (id) do nothing;

-- 2. Policies.
--    SELECT: open to anon (mirrors `public = true`, but we state it explicitly
--    so future tightening of bucket defaults doesn't silently break reads).
--    INSERT: authenticated only, and the first path segment must equal the
--    uploader's auth.uid() — enforces the `${profileId}/...` convention at
--    the DB layer.

drop policy if exists "evidence: public read" on storage.objects;
create policy "evidence: public read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'evidence');

drop policy if exists "evidence: owner insert" on storage.objects;
create policy "evidence: owner insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'evidence'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "evidence: owner update" on storage.objects;
create policy "evidence: owner update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'evidence'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'evidence'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );
