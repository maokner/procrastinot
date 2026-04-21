# Workstream A — Wallet-first authentication

**Status:** in-progress
**Owner agent:** claude-code (opus-4.7) session 2026-04-20
**Last updated:** 2026-04-20

## Checklist

- [ ] A1 — `supabase/migrations/0003_wallet_auth.sql`: make `profiles.username` nullable (drop + re-add check) — user must apply via Supabase SQL editor
- [ ] A2 — Add `SIWE_JWT_SECRET` env loader in `web/lib/env.ts`; document source (Supabase → Settings → API → JWT Secret)
- [ ] A3 — Rewrite `web/app/api/siwe/verify/route.ts` as session-minting entry point (JWT-direct mint, cookie via `@supabase/ssr`, returns `{ needsUsername }`)
- [ ] A4 — Rewrite `web/app/login/page.tsx` to a single-purpose page with `<SiweButton />`
- [ ] A5 — Delete `signup/page.tsx`, `SignupForm.tsx`, `LoginForm.tsx`; fix imports
- [ ] A6 — Simplify `onboarding/page.tsx` + `OnboardingClient.tsx` to username picker only
- [ ] A7 — Extend `web/middleware.ts` to gate protected routes (/my, /create, /inbox, /c/*, /settings, /profile/*, /onboarding)
- [ ] A8 — Add `NEXT_PUBLIC_SITE_URL`; prefer it over Host header in SIWE domain derivation
- [ ] A9 — Update `DEPLOYMENT.md` §3 env var table (+`SIWE_JWT_SECRET`, +`NEXT_PUBLIC_SITE_URL`) — user must add these in Vercel
- [ ] A10 — Manual browser test (user action)

## Notes / decisions log

- 2026-04-20 — Kickoff. Plan selects JWT-direct mint strategy (sign with Supabase JWT secret, HS256). Will use Node built-in `crypto` (no new deps).
- 2026-04-20 — Existing nonce store is keyed by `user.id` — but SIWE verify must now work pre-auth. Will rekey the nonce store by lowercased `address` for the verify path. The `/api/siwe/nonce` route will switch from GET to POST `{ address }` (no session required).
- 2026-04-20 — Workstream B is also in progress (docs/progress/workstream-b.md present). B consumes the `{ profile, walletAddress }` session shape which A preserves — no conflicts expected.

## Next action on resume

Implement A1: create `supabase/migrations/0003_wallet_auth.sql` making `profiles.username` nullable with an `is null OR regex` check constraint. After committing, set Status: blocked pending user applying the SQL.
