# Workstream C-oracle — Multimodal judge + runtime hardening

**Status:** blocked
**Owner agent:** claude-code (opus-4.7) session 2026-04-20
**Last updated:** 2026-04-20

## Checklist

- [x] C-oracle-1 — Refactor `oracle/src/evidence.ts` to return a typed `Evidence` union (text | image | images) with 10 MB image cap + JSON manifest fan-out
- [x] C-oracle-2 — Update `oracle/src/judge.ts` to consume the `Evidence` union and emit OpenAI multimodal content parts
- [x] C-oracle-3 — Thread the union through `oracle/src/poller.ts` preserving the `evidenceFailed` fallback
- [x] C-oracle-4 — Make scan chunk size configurable via `SCAN_CHUNK_BLOCKS` env var (`config.scanChunkBlocks`)
- [x] C-oracle-5 — Add `oracle/src/retry.ts` and wrap OpenAI + `getCommitment` calls with bounded exponential backoff + jitter
- [x] C-oracle-6 — `submitVerdict` waits for receipt (120 s); timeout is transient (stays `pending`)
- [x] C-oracle-7 — Detect `insufficient funds`; emit `oracle.gasDepleted` fatal log; keep verdict `pending`
- [ ] C-oracle-8 — Manual verification (user action — blocked)

## Notes / decisions log

- 2026-04-20 — Kickoff. Scope is strictly `oracle/src/{evidence,judge,poller,chain,config,retry}.ts`. No other files touched.
- 2026-04-20 — Completed C-oracle-1 through C-oracle-7 in the current tree. `pnpm --filter oracle build` now passes.
- 2026-04-20 — `poller.ts` now keeps verdicts `pending` on `getCommitment` read failures, judge failures, receipt timeouts, transient submit failures, and insufficient-funds conditions (`oracle.gasDepleted` fatal log). Evidence fetch/manifest failures still submit the canonical `passed=false` verdict.
- 2026-04-20 — Remaining blocker is C-oracle-8 manual verification against a live RPC + OpenAI environment (text evidence, image evidence, restart mid-processing, invalid `OPENAI_API_KEY`).

## Next action on resume

Run C-oracle-8 against a live environment: verify text and image evidence flows, restart safety, and that a bad `OPENAI_API_KEY` leaves verdicts pending after retries.
