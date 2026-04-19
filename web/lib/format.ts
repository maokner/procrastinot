import { formatUnits, parseUnits } from 'viem';

export const USDC_DECIMALS = 6;

export function formatUsdc(amount: bigint | undefined | null): string {
  if (amount === undefined || amount === null) return '0';
  return formatUnits(amount, USDC_DECIMALS);
}

export function parseUsdc(value: string): bigint {
  if (!value || value.trim() === '') return 0n;
  return parseUnits(value.trim(), USDC_DECIMALS);
}

export function countdown(deadline: bigint): string {
  const now = Math.floor(Date.now() / 1000);
  const remaining = Number(deadline) - now;
  if (remaining <= 0) return 'expired';
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Take user's raw evidence input and turn it into a valid `evidenceURI`.
 * - `ipfs://…` passthrough
 * - `http(s)://…` passthrough
 * - anything else gets wrapped as `text:<input>`
 */
export function toEvidenceURI(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (/^ipfs:\/\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^text:/i.test(trimmed)) return trimmed;
  return `text:${trimmed}`;
}

export function etherscanTxUrl(hash: string, chainId = 11155111): string {
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${hash}`;
  return `https://etherscan.io/tx/${hash}`;
}

export function etherscanAddressUrl(addr: string, chainId = 11155111): string {
  if (chainId === 11155111) return `https://sepolia.etherscan.io/address/${addr}`;
  return `https://etherscan.io/address/${addr}`;
}
