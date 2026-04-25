// EV ≈ 0.70 per unit wagered (30% house edge).
// Verified with binomial weights: Σ C(n,k)/2^n × multiplier(k) ≈ 0.70
export const MULTIPLIERS = {
  // 9 slots. EV = 180.2/256 = 0.704
  8: [9.0, 2.0, 0.9, 0.4, 0.5, 0.4, 0.9, 2.0, 9.0],
  // 13 slots. EV = 2908.7/4096 = 0.710
  12: [150, 8, 2, 1.0, 0.65, 0.5, 0.3, 0.5, 0.65, 1.0, 2, 8, 150],
  // 17 slots. EV = 45738.8/65536 = 0.698
  16: [200, 20, 7, 3.5, 1.8, 1.1, 0.7, 0.4, 0.2, 0.4, 0.7, 1.1, 1.8, 3.5, 7, 20, 200],
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

// Returns hex color for canvas or CSS use. Tiered red -> yellow gradient
// matches the Degen palette: jackpot-red at the edges, yellow near neutral,
// muted blue-gray through the loss zone, saturated red for worst losses.
export function multiplierColor(multiplier: number): string {
  if (multiplier >= 50) return '#ff2b2b';
  if (multiplier >= 8) return '#ff6a1a';
  if (multiplier >= 2) return '#ffa61a';
  if (multiplier >= 1) return '#ffd23f';
  if (multiplier >= 0.5) return '#5a6b84';
  return '#ff5544';
}

// P(landing in slot k) = C(n,k) / 2^n, where n = number of rows.
export function binProbability(n: number, k: number): number {
  return binomCoeff(n, k) / Math.pow(2, n);
}

export function expectedValue(rows: PlinkoRows): number {
  return MULTIPLIERS[rows].reduce(
    (sum, multiplier, slot) => sum + binProbability(rows, slot) * multiplier,
    0,
  );
}

function binomCoeff(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  const iters = Math.min(k, n - k);
  for (let i = 0; i < iters; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}
