import type { Abi } from 'viem';
import { useReadContract } from 'wagmi';
import { procrastinotAbi } from '@procrastinot/abi';

// TODO(phase-b): drop `as Abi` cast once the ABI JSON is populated.
export const abi = procrastinotAbi as unknown as Abi;

export const USDC_ADDRESS = (process.env.NEXT_PUBLIC_USDC_ADDRESS ??
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as `0x${string}`;

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ??
  '') as `0x${string}` | '';

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

/**
 * Thin wrapper that fetches a single commitment via `getCommitment(id)`.
 * Disabled until the ABI stub is populated and the contract address is configured.
 */
export function useCommitment(id: bigint | undefined) {
  return useReadContract({
    address: isContractConfigured() ? (CONTRACT_ADDRESS as `0x${string}`) : undefined,
    abi,
    functionName: 'getCommitment',
    args: id !== undefined ? [id] : undefined,
    query: {
      enabled: id !== undefined && isContractConfigured(),
    },
  });
}
