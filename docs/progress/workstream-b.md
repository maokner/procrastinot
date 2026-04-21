# Workstream B — Session header + real disconnect

**Status:** blocked
**Owner agent:** claude-code (opus-4.7) session 2026-04-20
**Last updated:** 2026-04-20

## Checklist

- [x] B1 — Create `web/components/layout/AppHeader.tsx` (server component)
- [x] B2 — Create `web/components/layout/SessionMenu.tsx` (client component)
- [x] B3 — Mount `<AppHeader />` in `web/app/layout.tsx`
- [x] B4 — Delete `SignOutButton.tsx`; remove duplicate button from `settings/page.tsx`
- [x] B5 — Mobile hamburger collapse at `< md`
- [ ] B6 — Manual browser verification (user action)

## Notes / decisions log

- 2026-04-20 — Kickoff. Existing helpers `requireProfile` / `getWallet` in `web/lib/auth.ts` will be reused by `AppHeader`. `AppHeader` will use `getSession` (non-throwing) so unauthed routes render a Connect-wallet CTA instead of redirecting.
- 2026-04-20 — Signout API route already exists at `web/app/api/auth/signout/route.ts`. `SessionMenu` will POST there, then wagmi `disconnect()`, then `router.push('/login')`.
- 2026-04-20 — Audit: B5 is already satisfied in `web/components/layout/AppHeader.tsx` via the `hidden md:flex` desktop rail plus the `md:hidden` `<details>` hamburger menu on mobile. No further code change is needed for the responsive header pass.
- 2026-04-20 — Remaining checkpoint is B6 only: verify the header renders on the protected routes and that `SessionMenu` disconnect clears the Supabase session plus the wagmi connector without the session reappearing on reload.

## Next action on resume

User checkpoint: run B6 on desktop and mobile. If the header/disconnect flow passes, mark Workstream B done; there is no remaining code task in this stream.
