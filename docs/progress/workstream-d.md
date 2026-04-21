# Workstream D — Contract hardening

**Status:** blocked
**Owner agent:** claude-code (opus-4.7) session 2026-04-20
**Last updated:** 2026-04-20

## Checklist

- [x] D1 — Swap `Ownable` for `Ownable2Step` in `contracts/src/Procrastinot.sol`
- [x] D2 — Add `InvalidOracle` / `InvalidOperator` custom errors + zero-address guards on `setOracle` / `setOperatorWallet`
- [x] D3 — Extend `contracts/test/Procrastinot.t.sol` with zero-address revert tests + two-step ownership handoff test
- [x] D4 — Run `forge test` and confirm full suite passes
- [x] D5 — Document deployment implications (fresh deploy required; see notes)
- [ ] D6 — User deploys new contract on Sepolia, tests two-step ownership handoff (user action)

## Notes / decisions log

- 2026-04-20 — Kickoff. OpenZeppelin `Ownable2Step.sol` confirmed vendored at `contracts/lib/openzeppelin-contracts/contracts/access/Ownable2Step.sol`. Constructor signature unchanged — `Ownable2Step` inherits `Ownable` and uses its `Ownable(initialOwner)` constructor.
- 2026-04-20 — D1 done. `forge build` passes after swapping base class to `Ownable2Step`. Kept the `Ownable` import because `Ownable2Step` references it by path only via its own import — actually the `Ownable` import is still used indirectly; left it in place for clarity.
- 2026-04-20 — Audit: the hardening in `contracts/src/Procrastinot.sol` is not upgradeable in place. This repo deploys a concrete `Procrastinot` instance via `contracts/script/Deploy.s.sol`, not a proxy, so any existing Sepolia deployment must be replaced with a fresh deployment to pick up `Ownable2Step` and the zero-address guards.
- 2026-04-20 — After redeploy, update `NEXT_PUBLIC_CONTRACT_ADDRESS` on Vercel plus `CONTRACT_ADDRESS` for the indexer, oracle, and local env files before restarting services. Use a fresh Supabase project and rerun `0001_init.sql` + `0002_oracle_state.sql` only if you want a clean history under the new contract; otherwise accept split historical data.

## Next action on resume

User checkpoint: deploy a fresh contract with `contracts/script/Deploy.s.sol`, rotate every contract-address env var to the new address, then verify `transferOwnership` -> `acceptOwnership` on Sepolia.
