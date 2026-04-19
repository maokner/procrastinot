export const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;
export const USDC_MAINNET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const;

// Filled in after deploy. Read by web + oracle via NEXT_PUBLIC_CONTRACT_ADDRESS / CONTRACT_ADDRESS env anyway;
// this export is for tests/scripts that prefer a constant.
export const PROCRASTINOT_SEPOLIA: `0x${string}` | '' = '';
