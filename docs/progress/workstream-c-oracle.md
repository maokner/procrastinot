# Workstream C-oracle — Multimodal judge + runtime hardening

**Status:** in-progress
**Owner agent:** claude-code (opus-4.7) session 2026-04-20
**Last updated:** 2026-04-20

## Checklist

- [ ] C-oracle-1 — Refactor `oracle/src/evidence.ts` to return a typed `Evidence` union (text | image | images) with 10 MB image cap + JSON manifest fan-out
- [ ] C-oracle-2 — Update `oracle/src/judge.ts` to consume the `Evidence` union and emit OpenAI multimodal content parts
- [ ] C-oracle-3 — Thread the union through `oracle/src/poller.ts` preserving the `evidenceFailed` fallback
- [ ] C-oracle-4 — Make scan chunk size configurable via `SCAN_CHUNK_BLOCKS` env var (`config.scanChunkBlocks`)
- [ ] C-oracle-5 — Add `oracle/src/retry.ts` and wrap OpenAI + `getCommitment` calls with bounded exponential backoff + jitter
- [ ] C-oracle-6 — `submitVerdict` waits for receipt (120 s); timeout is transient (stays `pending`)
- [ ] C-oracle-7 — Detect `insufficient funds`; emit `oracle.gasDepleted` fatal log; keep verdict `pending`
- [ ] C-oracle-8 — Manual verification (user action — blocked)

## Notes / decisions log

- 2026-04-20 — Kickoff. Scope is strictly `oracle/src/{evidence,judge,poller,chain,config,retry}.ts`. No other files touched.

## Next action on resume

Implement C-oracle-1: refactor `oracle/src/evidence.ts` to return the `Evidence` union.
