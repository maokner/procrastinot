# Procrastinot web

Next.js 15 App Router front-end for the Procrastinot commitment contract.

## Prereqs

- Node 24, pnpm 9.12
- Run `pnpm install` from the repo root

## Environment

Copy `.env.example` to `.env.local` and fill in:

| var                              | description                                                        |
| -------------------------------- | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_CONTRACT_ADDRESS`   | Deployed Procrastinot contract on Sepolia                          |
| `NEXT_PUBLIC_USDC_ADDRESS`       | Sepolia USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`)        |
| `NEXT_PUBLIC_CHAIN_ID`           | `11155111` (Sepolia)                                                |
| `NEXT_PUBLIC_RPC_URL`            | Your Sepolia RPC endpoint (Alchemy, Infura, etc.)                  |
| `NEXT_PUBLIC_WALLETCONNECT_ID`   | WalletConnect Cloud project id (for RainbowKit)                    |

The landing page renders without env vars. Write actions are disabled until `NEXT_PUBLIC_CONTRACT_ADDRESS` is set.

## Scripts

```
pnpm --filter web dev         # local dev at http://localhost:3000
pnpm --filter web build       # production build
pnpm --filter web start       # run built app
pnpm --filter web typecheck   # tsc --noEmit
pnpm --filter web lint        # next lint
```

## Notes

- USDC is 6 decimals — every parse/format uses `parseUnits(x, 6)` / `formatUnits(x, 6)`.
- The create flow is two steps: `approve` USDC then `create`. An indicator shows each step with an Etherscan link.
- Evidence submitted as plain text is wrapped as `text:<input>` before being sent to `requestVerdict`.
- `packages/abi` currently exports a stub ABI (`[] as const`); the ABI is cast to `Abi` in `lib/contract.ts` until the contracts agent publishes the real artifact.
