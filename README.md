# Procrastinot

Commit to a task, stake USDC, and let an oracle judge the evidence. If the
task passes, the user can withdraw the stake or route it into Degen Mode. If
the task misses the deadline without a pending verdict, the stake can be
forfeited to the chosen enemy wallet.

This repository contains the smart contracts, Next.js web app, Supabase
migrations, event indexer, oracle service, and shared ABI package.

## Current Deployment

Sepolia testnet:

| Contract | Address |
| --- | --- |
| Procrastinot | [`0x8a33F94c65eb0F8EF864EfA79cF746DFde3ab371`](https://sepolia.etherscan.io/address/0x8a33F94c65eb0F8EF864EfA79cF746DFde3ab371) |
| DegenVault | [`0xcC96326F4Cc7195C524b8D71580Ecafcfc17d38d`](https://sepolia.etherscan.io/address/0xcC96326F4Cc7195C524b8D71580Ecafcfc17d38d) |
| USDC | [`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`](https://sepolia.etherscan.io/address/0x1c7d4b196cb0c7b01d743fbc6116a902379c7238) |

Deploy block: `10725636`.

## Architecture

```text
contracts/       Foundry contracts and deployment scripts
web/             Next.js app, wallet auth, commitment UI, Degen Mode
oracle/          Server process that judges evidence and settles outcomes
indexer/         Server process that mirrors contract events into Supabase
supabase/        SQL migrations for app, oracle, indexer, and game state
packages/abi/    Shared generated ABI and contract types
scripts/         Repo maintenance scripts
```

High-level flow:

1. User creates a commitment with a stake, deadline, task, rubric, and enemy wallet.
2. Contract escrows the stake and emits events.
3. Indexer mirrors events into Supabase for fast web reads.
4. User submits evidence before the deadline.
5. Oracle evaluates the evidence.
6. If the oracle passes the attempt, the user chooses either Withdraw or Degen Mode.
7. If the attempt fails, the user can retry while attempts remain.
8. If the deadline passes with no pending verdict, the enemy can receive the stake.

## Local Development

Prerequisites:

- Node 20+
- pnpm 9+
- Foundry
- Supabase project or local Supabase-compatible Postgres
- Sepolia RPC URL
- OpenAI API key

Install:

```bash
pnpm install
pnpm sync:abi
```

Run the app stack:

```bash
pnpm --filter web dev
pnpm --filter oracle dev
pnpm --filter indexer dev
```

Common checks:

```bash
pnpm --filter web build
pnpm --filter web typecheck
pnpm --filter oracle build
pnpm --filter indexer build
pnpm test:contracts
```

## Environment

Do not commit env files. Use the example files in each package.

Web:

- `NEXT_PUBLIC_CONTRACT_ADDRESS`
- `NEXT_PUBLIC_DEGEN_VAULT_ADDRESS`
- `NEXT_PUBLIC_USDC_ADDRESS`
- `NEXT_PUBLIC_CHAIN_ID`
- `NEXT_PUBLIC_RPC_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ORACLE_API_URL`

Oracle:

- `RPC_URL`
- `CHAIN`
- `ORACLE_PRIVATE_KEY`
- `CONTRACT_ADDRESS`
- `DEGEN_VAULT_ADDRESS`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `START_BLOCK`

Indexer:

- `RPC_URL`
- `CHAIN`
- `CONTRACT_ADDRESS`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `START_BLOCK`

Contracts:

- `SEPOLIA_RPC_URL`
- `DEPLOYER_PRIVATE_KEY`
- `ETHERSCAN_API_KEY`
- `ORACLE_ADDRESS`
- `OPERATOR_ADDRESS`
- `USDC_ADDRESS`

## Deploy Contracts

```bash
cd contracts

forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --broadcast \
  --verify \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  -vvvv
```

After deploying, update Vercel, Railway, and Supabase cursors with the new
contract addresses and deploy block.

## Notes

- The oracle private key and Supabase service-role key must only exist in server
  environments.
- Degen Mode game outcomes are calculated server-side and stored in Supabase.
- The DegenVault is on-chain escrow for commitment funds; the oracle wallet is
  the house bank for payouts above deposited funds.
- Current product follow-ups are tracked in [NEXT_STEPS.md](./NEXT_STEPS.md).
