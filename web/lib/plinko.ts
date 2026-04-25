// EV is determined by the live Matter.js physics distribution × this table,
// NOT by a binomial assumption. The runtime distribution is empirically
// measured via scripts/plinko-calibrate.ts; physics params in
// plinko-physics.ts are tuned so EV < 1 at every row count.
//
// 10k-sample empirical EV (see scripts/plinko-calibrate.ts validate):
//   8-row:  EV = 0.458   (house edge 54.2%)
//   12-row: EV = 0.431   (house edge 56.9%)
//   16-row: EV = 0.909   (house edge  9.1%)
//
// 8 and 12 collapse to a 3–5 slot center cluster under current physics
// (jackpots unreachable). 16 produces a healthy spread; the 50x edge slot
// is effectively unreachable, 20x lands ~0.04% of drops.
export const MULTIPLIERS = {
  // 9 slots
  8: [9.0, 2.0, 0.9, 0.4, 0.5, 0.4, 0.9, 2.0, 9.0],
  // 13 slots
  12: [50, 10, 2.5, 1.0, 0.7, 0.5, 0.3, 0.5, 0.7, 1.0, 2.5, 10, 50],
  // 17 slots
  16: [50, 20, 7, 3.5, 1.8, 1.1, 0.7, 0.4, 0.25, 0.4, 0.7, 1.1, 1.8, 3.5, 7, 20, 50],
} as const;

export type PlinkoRows = keyof typeof MULTIPLIERS;

export const PLINKO_ROWS = [8, 12, 16] as const;
export const MIN_BET_USDC = 0.1;
export const MIN_BET_UNITS = 100_000;
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
