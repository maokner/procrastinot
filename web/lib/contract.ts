import type { Abi } from 'viem';
import { procrastinotAbi } from '@procrastinot/abi';

// TODO(phase-b): drop `as Abi` cast once the ABI JSON is populated.
export const abi = procrastinotAbi as unknown as Abi;

export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as `0x${string}`;

// Fall back to the canonical Sepolia deployment from the README so the
// app stays functional if NEXT_PUBLIC_CONTRACT_ADDRESS is unset on the
// host. Other env-derived addresses (USDC, chain id) already follow the
// same fallback pattern below; this keeps them consistent.
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
  '0x8a33F94c65eb0F8EF864EfA79cF746DFde3ab371') as `0x${string}`;

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11155111);

export function isContractConfigured(): boolean {
  return Boolean(CONTRACT_ADDRESS) && CONTRACT_ADDRESS.startsWith('0x');
}

// Minimal ERC-20 ABI for USDC approval/allowance.
export const erc20Abi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const satisfies Abi;
