# Workstream A — Wallet-first authentication

**Status:** blocked
**Owner agent:** claude-code (opus-4.7) session 2026-04-20
**Last updated:** 2026-04-20

## Checklist

- [x] A1 — `supabase/migrations/0003_wallet_auth.sql`: make `profiles.username` nullable (drop + re-add check) — user must apply via Supabase SQL editor
- [x] A2 — Add `SIWE_JWT_SECRET` env loader in `web/lib/env.ts`; document source (Supabase → Settings → API → JWT Secret)
- [x] A3 — Rewrite `web/app/api/siwe/verify/route.ts` as session-minting entry point (returns `{ needsUsername }`, provisions auth/profile/wallet rows, sets SSR auth cookies)
- [x] A4 — Rewrite `web/app/login/page.tsx` to a single-purpose page with `<SiweButton />`
- [x] A5 — Delete `signup/page.tsx`, `SignupForm.tsx`, `LoginForm.tsx`; fix imports
- [x] A6 — Simplify `onboarding/page.tsx` + `OnboardingClient.tsx` to username picker only
- [x] A7 — Extend `web/middleware.ts` to gate protected routes (/my, /create, /inbox, /c/*, /settings, /profile/*, /onboarding)
- [x] A8 — Add `NEXT_PUBLIC_SITE_URL`; prefer it over Host header in SIWE domain derivation
- [x] A9 — Update `DEPLOYMENT.md` §3 env var table (+`SIWE_JWT_SECRET`, +`NEXT_PUBLIC_SITE_URL`) — user must add these in Vercel
- [ ] A10 — Manual browser test (user action)

## Notes / decisions log

- 2026-04-20 — Kickoff. Plan selects JWT-direct mint strategy (sign with Supabase JWT secret, HS256). Will use Node built-in `crypto` (no new deps).
- 2026-04-20 — Existing nonce store is keyed by `user.id` — but SIWE verify must now work pre-auth. Will rekey the nonce store by lowercased `address` for the verify path. The `/api/siwe/nonce` route will switch from GET to POST `{ address }` (no session required).
- 2026-04-20 — Workstream B is also in progress (docs/progress/workstream-b.md present). B consumes the `{ profile, walletAddress }` session shape which A preserves — no conflicts expected.
- 2026-04-20 — Redirects and helper assumptions now treat onboarding complete as `profiles.username` being non-null. A profile row alone is no longer enough.
- 2026-04-20 — Switched A3 from direct JWT minting to `admin.generateLink(...magiclink)` + `auth.verifyOtp({ token_hash })` after confirming installed auth-js requires both `access_token` and `refresh_token` for `setSession()`. This keeps normal Supabase refresh semantics.
- 2026-04-20 — Legacy `/signup` is removed from the app surface; middleware now redirects any stale `/signup` hits to `/login`.

## Next action on resume

User checkpoints only: apply `supabase/migrations/0003_wallet_auth.sql` if it is not already applied in Supabase, add `NEXT_PUBLIC_SITE_URL` + `SIWE_JWT_SECRET` in Vercel, then run the wallet-first browser test (new wallet → `/onboarding`, username pick → `/my`, reconnect → `/my`).
