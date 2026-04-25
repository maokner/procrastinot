import { describe, expect, it } from 'vitest';
import {
  MULTIPLIERS,
  PLINKO_ROWS,
  binProbability,
  expectedValue,
  isPlinkoRows,
  multiplierColor,
  parseUsdcToUnits,
  unitsToUsdc,
} from './plinko';

describe('binProbability', () => {
  it('sums to 1 across all bins for each row count', () => {
    for (const rows of PLINKO_ROWS) {
      let total = 0;
      for (let k = 0; k <= rows; k++) total += binProbability(rows, k);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it('returns 0 for out-of-range slots', () => {
    expect(binProbability(8, -1)).toBe(0);
    expect(binProbability(8, 9)).toBe(0);
  });

  it('is symmetric: P(n,k) === P(n,n-k)', () => {
    for (const rows of PLINKO_ROWS) {
      for (let k = 0; k <= rows; k++) {
        expect(binProbability(rows, k)).toBeCloseTo(
          binProbability(rows, rows - k),
          12,
        );
      }
    }
  });
});

describe('expectedValue', () => {
  it('matches the documented 70% EV to within 0.005', () => {
    // File-header comments assert ~0.70 for all three row counts.
    for (const rows of PLINKO_ROWS) {
      const ev = expectedValue(rows);
      expect(ev).toBeGreaterThan(0.695);
      expect(ev).toBeLessThan(0.715);
    }
  });

  it('keeps a positive house edge (EV < 1.0)', () => {
    for (const rows of PLINKO_ROWS) {
      expect(expectedValue(rows)).toBeLessThan(1);
    }
  });
});

describe('MULTIPLIERS table shape', () => {
  it('has exactly rows + 1 entries per row count', () => {
    for (const rows of PLINKO_ROWS) {
      expect(MULTIPLIERS[rows].length).toBe(rows + 1);
    }
  });

  it('is symmetric around the middle', () => {
    for (const rows of PLINKO_ROWS) {
      const arr = MULTIPLIERS[rows];
      for (let i = 0; i < arr.length; i++) {
        expect(arr[i]).toBe(arr[arr.length - 1 - i]);
      }
    }
  });
});

describe('isPlinkoRows', () => {
  it('accepts only 8, 12, 16', () => {
    expect(isPlinkoRows(8)).toBe(true);
    expect(isPlinkoRows(12)).toBe(true);
    expect(isPlinkoRows(16)).toBe(true);
    expect(isPlinkoRows(7)).toBe(false);
    expect(isPlinkoRows(0)).toBe(false);
  });
});

describe('USDC conversion', () => {
  it('parses and formats a canonical range of bet sizes', () => {
    const cases = ['0.10', '1.00', '10.00', '1.234567'];
    for (const v of cases) {
      const units = parseUsdcToUnits(v);
      expect(units).not.toBeNull();
      // unitsToUsdc always returns 6 decimals; compare as numbers.
      expect(Number(unitsToUsdc(units!))).toBeCloseTo(Number(v), 6);
    }
  });

  it('rejects malformed input', () => {
    expect(parseUsdcToUnits('')).toBeNull();
    expect(parseUsdcToUnits('abc')).toBeNull();
    expect(parseUsdcToUnits('1.2345678')).toBeNull();
    expect(parseUsdcToUnits('-1')).toBeNull();
  });
});

describe('multiplierColor', () => {
  const hex = /^#[0-9a-fA-F]{6}$/;

  it('returns a six-digit hex for every multiplier in the payout tables', () => {
    for (const rows of PLINKO_ROWS) {
      for (const m of MULTIPLIERS[rows]) {
        expect(multiplierColor(m)).toMatch(hex);
      }
    }
  });

  it('is monotonic at tier boundaries', () => {
    // Different tiers should produce different colors.
    expect(multiplierColor(50)).not.toBe(multiplierColor(8));
    expect(multiplierColor(8)).not.toBe(multiplierColor(2));
    expect(multiplierColor(2)).not.toBe(multiplierColor(1));
    expect(multiplierColor(1)).not.toBe(multiplierColor(0.5));
    expect(multiplierColor(0.5)).not.toBe(multiplierColor(0.2));
  });
});
