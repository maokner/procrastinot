# Next Steps

This is the public working backlog. Keep it short, concrete, and current.

## Recently shipped

- [x] Dark-navy Degen Mode palette, scoped to `/degen` and `/demo/plinko`.
      Global header adopts the palette on Degen pages without edits to
      `AppHeader.tsx`.
- [x] Ball / peg / bucket visual overhaul: white pegs, expanding peg-hit
      rings, bouncy red ball with shadow, gradient buckets with bounce-
      on-land, stacked payout cards.
- [x] Win / loss flash after each landing.
- [x] Production `/degen` now runs a server-side Matter.js simulation
      seeded from the existing HMAC bytes. The server records the
      trajectory + peg hits and sends them to the client, which plays
      them back at 60 fps. No more guided velocity snaps — pure physics
      end-to-end, with the commit-reveal seed scheme still providing
      provable fairness.
- [x] Dev-only `/demo/plinko` route (404 in production) for iterating on
      visuals + physics without Supabase or auth. Spacebar = drop (tap
      for one, hold for continuous). Pure / guided mode toggle for
      side-by-side comparison. `pnpm plinko:demo` to run it.
- [x] Synthesized sound effects via the Web Audio API (no assets shipped):
      tonal plinks with pitch variance on peg hits, tier-based warm
      chord on bucket landing. Mute toggle persisted in `localStorage`.
- [x] Optimistic balance: Drop click immediately debits the bet from the
      displayed balance; the ball credits the payout when it lands.
- [x] Stuck-ball detection and lifetime cap (guided balls only). Pure
      balls land on geometry contact alone.
- [x] Matter.js collision categories so balls never collide with each
      other — no more pile-ups at high ball counts.
- [x] Ball cap raised from 6 to 20.
- [x] Recent drops sidebar capped at 6 rows so the page fits on-screen
      without scrolling.
- [x] vitest + unit tests for `web/lib/plinko.ts` math (binomial sum,
      EV bounds, `MULTIPLIERS` shape / symmetry, USDC conversion,
      `multiplierColor` format). 12 cases, all green.

## Still open

- [ ] Analytics / logging around drops, failures, and cashouts. Useful
      for catching sim divergence between server and any future client
      verifier, and for bet-sizing / retention dashboards.
- [ ] Docked short-form video / Reels feed inside Degen Mode.
      Substantial separate feature — deferred.
- [ ] Package READMEs aligned with the current Supabase-backed
      architecture.
- [ ] Refresh README contract addresses on the next Sepolia deploy.
- [ ] UI screenshots in README once the Degen surface is stable enough
      to represent the product.

## Ground rules

- Server-side outcome stays the source of truth. The trajectory sent to
  the client is a recording, not a suggestion.
- Keep probability tables + EV documented in `web/lib/plinko.ts` and
  guarded by `web/lib/plinko.test.ts`.
- Remove items from this list as they ship. Stale entries are worse
  than a shorter list.
- Avoid internal-only references in public docs.
