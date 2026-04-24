# Next Steps

This is the public working backlog. Keep it short, concrete, and current.

## Degen Mode UI

- Redesign the `/degen` page so it feels like a polished game surface instead
  of a raw debug board.
- Improve the Plinko board visual system:
  - Better ball rendering.
  - Better peg rendering.
  - Better bucket rendering.
  - Clearer payout and odds display.
  - Better mobile layout.
- Add a more intentional win/loss result treatment after each ball lands.
- Review the current color palette and typography for Degen Mode separately
  from the main commitment app.
- Explore a split-screen or docked Reels feed inside Degen Mode so users can
  scroll short-form video while keeping Plinko controls visible and usable.

## Plinko Physics Follow-Ups

- Make balls disappear immediately after they land in their bucket.
- Prevent balls from lingering under or around payout buckets.
- Add stuck-ball detection and cleanup:
  - If a ball remains almost motionless for a short timeout, remove it.
  - If a ball takes too long to land, remove it and settle the UI from the
    server result.
- Fix the bucket-entry behavior shown in the latest screenshot, where balls can
  rest between lower pegs or near bucket dividers.
- Tune the board geometry so the physical ball path has a clean exit into the
  selected bucket.
- Revisit Matter.js collision categories if balls or pegs create unwanted
  pileups.

## Plinko Product Logic

- Keep server-side outcome generation as the source of truth.
- Keep probability tables and payout EV documented in `web/lib/plinko.ts`.
- Add a small automated test for:
  - binomial probability sums,
  - expected value by row count,
  - multiplier table length matching `rows + 1`.
- Add analytics/logging around drops, failures, and cashouts.

## Public Repo Hygiene

- Keep README addresses current after every contract deployment.
- Keep package READMEs aligned with the current Supabase-backed architecture.
- Remove stale implementation notes when a feature ships.
- Avoid internal-only references in public docs.
- Add screenshots only once the UI is stable enough to represent the product.
