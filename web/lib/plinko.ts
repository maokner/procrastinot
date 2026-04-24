export const MULTIPLIERS = {
  // 9 slots (rows+1). Center reduced for ~93.5% RTP house edge.
  8: [5.6, 2.1, 1.1, 1.0, 0.3, 1.0, 1.1, 2.1, 5.6],
  // 13 slots (rows+1). Fixed from 11-element bug. ~95.5% RTP.
  12: [8.9, 3.0, 1.4, 1.1, 1.0, 0.9, 0.8, 0.9, 1.0, 1.1, 1.4, 3.0, 8.9],
  // 17 slots (rows+1). Center reduced for ~95.1% RTP house edge.
  16: [16.0, 9.0, 2.0, 1.4, 1.4, 1.2, 1.1, 1.0, 0.3, 1.0, 1.1, 1.2, 1.4, 1.4, 2.0, 9.0, 16.0],
} as const;

export type PlinkoRows = keyof typeof MULTIPLIERS;

export const PLINKO_ROWS = [8, 12, 16] as const;
export const MIN_BET_USDC = 0.1;
export const MAX_BET_USDC = 10;
export const MIN_BET_UNITS = 100_000;
export const MAX_BET_UNITS = 10_000_000;
export const USDC_UNITS = 1_000_000;

export function isPlinkoRows(value: number): value is PlinkoRows {
  return value === 8 || value === 12 || value === 16;
}

export function unitsToUsdc(units: number | bigint): string {
  const n = typeof units === 'bigint' ? Number(units) : units;
  return (n / USDC_UNITS).toFixed(6);
}

export function parseUsdcToUnits(value: unknown): bigint | null {
  const raw = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole) * BigInt(USDC_UNITS) + BigInt(fraction.padEnd(6, '0'));
}

export function multiplierColor(multiplier: number): string {
  if (multiplier >= 5) return 'var(--success)';
  if (multiplier >= 2) return '#b45309';
  if (multiplier >= 1) return 'var(--ink-1)';
  return 'var(--danger)';
}
