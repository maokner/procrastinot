# Procrastinot

An on-chain commitment device. Stake USDC against a self-defined task with a deadline. Prove completion via an LLM-judge oracle, or your stake gets sent to a wallet you'd hate losing to (your "enemy").

> **v1 = Sepolia testnet only.** The oracle is a single trusted LLM-backed signer — no fancy decentralization yet. The point is to show the loop.

## Layout

```
procrastinot/
├── contracts/        # Foundry: Procrastinot.sol + tests + deploy
├── oracle/           # Node + viem + OpenAI: listens, judges, submits verdicts
├── web/              # Next.js + wagmi: create / submit / forfeit UI
├── packages/abi/     # Shared TypeScript types + ABI export
└── scripts/          # sync-abi.ts (copies Foundry artifact into packages/abi)
```

## Quickstart

Prereqs: Node 20+, pnpm 9, [Foundry](https://book.getfoundry.sh/getting-started/installation), an Ethereum wallet, Sepolia ETH, and Sepolia USDC.

```bash
pnpm install

# 1. Contracts: test + deploy
cd contracts
forge install
forge test -vvv
# fill contracts/.env from .env.example
forge script script/Deploy.s.sol:Deploy --rpc-url $SEPOLIA_RPC_URL --broadcast --verify

# 2. Sync ABI into the shared package + paste deployed address into packages/abi/src/addresses.ts
cd ..
pnpm sync:abi

# 3. Oracle (long-running)
pnpm --filter oracle dev

# 4. Web app
pnpm --filter web dev
```

## Getting test funds

- **Sepolia ETH** for gas: <https://sepoliafaucet.com> or <https://www.alchemy.com/faucets/ethereum-sepolia>
- **Sepolia USDC** to stake: <https://faucet.circle.com> (pick Ethereum Sepolia)

## Trust model (v1)

- One off-chain oracle signer. It reads task + rubric + evidence and decides pass/fail. If it goes offline, you can still `forfeit` past your deadline (anyone can call); you just can't `submitVerdict` to recover the stake.
- The contract is non-upgradeable and has no admin escape hatch for active commitments. That's intentional — the whole product is "I cannot un-commit, even with help."
