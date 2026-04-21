# Workstream C-web — Image upload UI + Supabase Storage

**Status:** blocked
**Owner agent:** claude-code (opus-4.7) session 2026-04-20
**Last updated:** 2026-04-20

## Checklist

- [x] C-web-1 — `supabase/migrations/0004_evidence_storage.sql` (bucket + policies; user applies SQL)
- [x] C-web-2 — `web/lib/storage.ts` upload helper
- [ ] C-web-3 — `web/lib/image-resize.ts` client-side resize helper
- [ ] C-web-4 — Rewrite `SubmitEvidenceForm.tsx` with Photo + Link/text tabs
- [ ] C-web-5 — Render image thumbnails from manifest in the evidence view
- [ ] C-web-6 — Manual browser verification (user action)

## Notes / decisions log

- 2026-04-20 — Kickoff. Browser Supabase client lives at `web/lib/supabase.ts` (`supabaseBrowser()`), not `supabase-browser.ts`; using that. `VerdictLog.tsx` is the current evidence renderer (no separate `EvidenceCard.tsx`). It will be extended with a thumbnail block that fetches the manifest when `evidence_uri` is a Supabase Storage URL.
- 2026-04-20 — Path convention: `${profileId}/${commitmentId}/${attempt}-${index}.${ext}` plus `${profileId}/${commitmentId}/${attempt}-manifest.json`. First folder segment must equal `auth.uid()::text` to satisfy the INSERT policy (`storage.foldername(name)[1] = auth.uid()::text`).
- 2026-04-20 — HEIC: browser `createImageBitmap` cannot decode HEIC in Safari/Chrome desktop. Skip resize and upload original file.

- 2026-04-20 — C-web-1 done. BLOCKED pending user action: paste
  `supabase/migrations/0004_evidence_storage.sql` into the Supabase SQL Editor
  and confirm the `evidence` bucket appears in Storage with the three RLS
  policies (`evidence: public read`, `evidence: owner insert`,
  `evidence: owner update`). Agent continues with the web code (C-web-2
  through C-web-5) in parallel — they can be written and committed before
  the SQL lands, since uploads only start failing at runtime, not at build
  time.

## Next action on resume

User: apply `supabase/migrations/0004_evidence_storage.sql` in the Supabase
dashboard (still blocking C-web-6). Agent: implement C-web-3
(`web/lib/image-resize.ts`).
