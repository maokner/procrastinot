# Web

Next.js 15 App Router front-end for the Procrastinot commitment contract.

## Prereqs

- Node 24, pnpm 9.12
- Run `pnpm install` from the repo root

## Environment

Copy `.env.example` to `.env.local` and fill in:

| var                              | description                                                        |
| -------------------------------- | ------------------------------------------------------------------ |
| `NEXT_PUBLIC_CONTRACT_ADDRESS`   | Deployed Procrastinot contract on Sepolia                          |
| `NEXT_PUBLIC_DEGEN_VAULT_ADDRESS` | Deployed DegenVault contract on Sepolia                           |
| `NEXT_PUBLIC_USDC_ADDRESS`       | Sepolia USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`)        |
| `NEXT_PUBLIC_CHAIN_ID`           | `11155111` (Sepolia)                                                |
| `NEXT_PUBLIC_RPC_URL`            | Your Sepolia RPC endpoint (Alchemy, Infura, etc.)                  |
| `NEXT_PUBLIC_WALLETCONNECT_ID`   | WalletConnect Cloud project id (for RainbowKit)                    |
| `NEXT_PUBLIC_SUPABASE_URL`       | Supabase project URL                                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Supabase anon key                                                   |
| `SUPABASE_SERVICE_ROLE_KEY`      | Server-only Supabase service-role key                               |
| `ORACLE_API_URL`                 | Server-only Railway oracle base URL                                 |

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
- Evidence can be submitted as text or uploaded images.
- Degen Mode Plinko outcomes are calculated by the server route and mirrored
  into Supabase; the canvas board is presentation only.
