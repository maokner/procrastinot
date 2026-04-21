# Workstream D — Contract hardening

**Status:** in-progress
**Owner agent:** claude-code (opus-4.7) session 2026-04-20
**Last updated:** 2026-04-20

## Checklist

- [x] D1 — Swap `Ownable` for `Ownable2Step` in `contracts/src/Procrastinot.sol`
- [ ] D2 — Add `InvalidOracle` / `InvalidOperator` custom errors + zero-address guards on `setOracle` / `setOperatorWallet`
- [ ] D3 — Extend `contracts/test/Procrastinot.t.sol` with zero-address revert tests + two-step ownership handoff test
- [ ] D4 — Run `forge test` and confirm full suite passes
- [ ] D5 — Document deployment implications (user action)
- [ ] D6 — User deploys new contract on Sepolia, tests two-step ownership handoff (user action)

## Notes / decisions log

- 2026-04-20 — Kickoff. OpenZeppelin `Ownable2Step.sol` confirmed vendored at `contracts/lib/openzeppelin-contracts/contracts/access/Ownable2Step.sol`. Constructor signature unchanged — `Ownable2Step` inherits `Ownable` and uses its `Ownable(initialOwner)` constructor.
- 2026-04-20 — D1 done. `forge build` passes after swapping base class to `Ownable2Step`. Kept the `Ownable` import because `Ownable2Step` references it by path only via its own import — actually the `Ownable` import is still used indirectly; left it in place for clarity.

## Next action on resume

Implement D2: add `InvalidOracle` / `InvalidOperator` errors and zero-address guards in `setOracle` / `setOperatorWallet`.
