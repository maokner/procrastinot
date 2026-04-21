# Workstream C-web — Image upload UI + Supabase Storage

**Status:** in-progress
**Owner agent:** claude-code (opus-4.7) session 2026-04-20
**Last updated:** 2026-04-20

## Checklist

- [ ] C-web-1 — `supabase/migrations/0004_evidence_storage.sql` (bucket + policies; user applies SQL)
- [ ] C-web-2 — `web/lib/storage.ts` upload helper
- [ ] C-web-3 — `web/lib/image-resize.ts` client-side resize helper
- [ ] C-web-4 — Rewrite `SubmitEvidenceForm.tsx` with Photo + Link/text tabs
- [ ] C-web-5 — Render image thumbnails from manifest in the evidence view
- [ ] C-web-6 — Manual browser verification (user action)

## Notes / decisions log

- 2026-04-20 — Kickoff. Browser Supabase client lives at `web/lib/supabase.ts` (`supabaseBrowser()`), not `supabase-browser.ts`; using that. `VerdictLog.tsx` is the current evidence renderer (no separate `EvidenceCard.tsx`). It will be extended with a thumbnail block that fetches the manifest when `evidence_uri` is a Supabase Storage URL.
- 2026-04-20 — Path convention: `${profileId}/${commitmentId}/${attempt}-${index}.${ext}` plus `${profileId}/${commitmentId}/${attempt}-manifest.json`. First folder segment must equal `auth.uid()::text` to satisfy the INSERT policy (`storage.foldername(name)[1] = auth.uid()::text`).
- 2026-04-20 — HEIC: browser `createImageBitmap` cannot decode HEIC in Safari/Chrome desktop. Skip resize and upload original file.

## Next action on resume

Implement C-web-1: write `supabase/migrations/0004_evidence_storage.sql`, commit, and mark the subtask blocked pending the user running the SQL in the Supabase dashboard.
