# Procrastinot contracts

Foundry project for the `Procrastinot` on-chain commitment contract.

`forge` must be on your PATH (`curl -L https://foundry.paradigm.xyz | bash && foundryup`).

## Layout

- `src/Procrastinot.sol` — the contract.
- `test/Procrastinot.t.sol` — Foundry test suite (18 tests).
- `test/mocks/` — `MockUSDC` (6-decimal mintable ERC20) and `MaliciousToken` (reentrancy-on-transfer ERC20).
- `script/Deploy.s.sol` — deploy to any EVM chain via env config.
- `foundry.toml` — solc 0.8.24, optimizer (200 runs), evm_version=cancun.

## Build

```sh
forge build
```

Produces `out/Procrastinot.sol/Procrastinot.json` (ABI + bytecode). The repo-infra agent publishes this as `@procrastinot/abi`.

## Test

```sh
forge test -vvv
```

All 18 tests must pass. Covers: create validation, per-attempt fee deduction, attempt cap, deadline gating, oracle-only submission, pass/fail flows, permissionless forfeit, double-resolve protection, reentrancy via malicious ERC20, and a whole-contract accounting invariant.

## Deploy

1. Copy `.env.example` to `.env` and fill in `SEPOLIA_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `ETHERSCAN_API_KEY`, `ORACLE_ADDRESS`, `OPERATOR_ADDRESS`. `USDC_ADDRESS` defaults to Sepolia USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`).

2. Source the env and deploy:

```sh
source .env
forge script script/Deploy.s.sol:Deploy \
    --rpc-url "$SEPOLIA_RPC_URL" \
    --broadcast \
    --verify \
    --etherscan-api-key "$ETHERSCAN_API_KEY"
```

To dry-run without broadcasting, drop `--broadcast --verify`:

```sh
forge script script/Deploy.s.sol:Deploy --rpc-url "$SEPOLIA_RPC_URL"
```

The deployer address (recovered from `DEPLOYER_PRIVATE_KEY`) becomes the contract owner and can rotate `oracle` / `operatorWallet` via `setOracle` / `setOperatorWallet`. There is no escape hatch for active commitments by design.

## Contract surface

See `00-shared-interface.md` in the plan directory for the canonical ABI.

- `create(enemy, stake, oracleFee, deadline, task, rubric) -> id`
- `requestVerdict(id, evidenceURI)` — user only, deducts `initialOracleFee / 3` to operator per attempt
- `submitVerdict(id, passed, reasonHash)` — oracle only; pass refunds stake to user + remaining fee to operator
- `forfeit(id)` — permissionless after deadline; sends stake + unspent oracleFee to enemy
- `getCommitment(id) -> Commitment`
