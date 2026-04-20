export const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;
export const USDC_MAINNET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;

// v1 — deprecated. On `forfeit`, both stake and unspent oracleFee were sent to the enemy.
// Kept here for historical reference; do not target for new integrations.
// https://sepolia.etherscan.io/address/0xae8303ec8465a888e19d4a50f91053831e2269a2
export const PROCRASTINOT_SEPOLIA_V1: `0x${string}` | '' = '0xaE8303EC8465A888E19d4A50f91053831e2269a2';

// v2 — current canonical. On `forfeit`, stake -> enemy, unspent oracleFee -> operator.
// Deployed via `forge script Deploy --broadcast --verify` on 2026-04-19.
// https://sepolia.etherscan.io/address/0x25df2268051203cf73beb8cd9cd55c313370fb26
export const PROCRASTINOT_SEPOLIA: `0x${string}` | '' = '0x25DF2268051203cf73beb8cD9Cd55c313370FB26';

// Block at which the v2 contract was deployed. Indexers and log-scan backfills
// should start from this block (or later) to avoid reading pre-deploy history.
export const PROCRASTINOT_DEPLOY_BLOCK: bigint = 10694179n;
