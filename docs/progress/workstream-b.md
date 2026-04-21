# Workstream B — Session header + real disconnect

**Status:** in-progress
**Owner agent:** claude-code (opus-4.7) session 2026-04-20
**Last updated:** 2026-04-20

## Checklist

- [ ] B1 — Create `web/components/layout/AppHeader.tsx` (server component)
- [ ] B2 — Create `web/components/layout/SessionMenu.tsx` (client component)
- [ ] B3 — Mount `<AppHeader />` in `web/app/layout.tsx`
- [ ] B4 — Delete `SignOutButton.tsx`; remove duplicate button from `settings/page.tsx`
- [ ] B5 — Mobile hamburger collapse at `< md`
- [ ] B6 — Manual browser verification (user action)

## Notes / decisions log

- 2026-04-20 — Kickoff. Existing helpers `requireProfile` / `getWallet` in `web/lib/auth.ts` will be reused by `AppHeader`. `AppHeader` will use `getSession` (non-throwing) so unauthed routes render a Connect-wallet CTA instead of redirecting.
- 2026-04-20 — Signout API route already exists at `web/app/api/auth/signout/route.ts`. `SessionMenu` will POST there, then wagmi `disconnect()`, then `router.push('/login')`.

## Next action on resume

Implement B1: create `web/components/layout/AppHeader.tsx` as a server component that reuses `getSession`, `getProfile`, `getWallet` from `web/lib/auth.ts`.
