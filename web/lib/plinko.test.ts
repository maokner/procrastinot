import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TARGET_RTP,
  PLINKO_ROWS,
  RISK_LEVELS,
  binProbability,
  binomialProbabilities,
  expectedValue,
  formatMultiplier,
  generateMultipliers,
  getMultipliers,
  isPlinkoRows,
  isRiskLevel,
  multiplierColor,
  parseUsdcToUnits,
  unitsToUsdc,
} from './plinko';

describe('binomialProbabilities', () => {
  it('sums to 1 for each row count', () => {
    for (const rows of PLINKO_ROWS) {
      const p = binomialProbabilities(rows);
      const total = p.reduce((s, x) => s + x, 0);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it('is symmetric around the middle', () => {
    for (const rows of PLINKO_ROWS) {
      const p = binomialProbabilities(rows);
      for (let k = 0; k <= rows; k++) {
        expect(p[k]).toBeCloseTo(p[rows - k], 12);
      }
    }
  });

  it('center bucket is the most probable', () => {
    for (const rows of PLINKO_ROWS) {
      const p = binomialProbabilities(rows);
      const center = Math.floor(rows / 2);
      for (let k = 0; k <= rows; k++) {
        if (k !== center && k !== rows - center) {
          expect(p[center]).toBeGreaterThan(p[k]);
        }
      }
    }
  });

  it('edge buckets are 1/2^n', () => {
    for (const rows of PLINKO_ROWS) {
      const p = binomialProbabilities(rows);
      const expected = 1 / Math.pow(2, rows);
      expect(p[0]).toBeCloseTo(expected, 12);
      expect(p[rows]).toBeCloseTo(expected, 12);
    }
  });

  it('binProbability matches the array form', () => {
    for (const rows of PLINKO_ROWS) {
      const arr = binomialProbabilities(rows);
      for (let k = 0; k <= rows; k++) {
        expect(binProbability(rows, k)).toBeCloseTo(arr[k], 12);
      }
    }
  });
});

describe('generateMultipliers', () => {
  it('produces rows + 1 entries', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISK_LEVELS) {
        expect(generateMultipliers(rows, risk).length).toBe(rows + 1);
      }
    }
  });

  it('is symmetric', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISK_LEVELS) {
        const m = generateMultipliers(rows, risk);
        for (let k = 0; k <= rows; k++) {
          expect(m[k]).toBeCloseTo(m[rows - k], 10);
        }
      }
    }
  });

  it('center bucket has the smallest multiplier', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISK_LEVELS) {
        const m = generateMultipliers(rows, risk);
        const center = Math.floor(rows / 2);
        for (let k = 0; k <= rows; k++) {
          if (k !== center && k !== rows - center) {
            expect(m[k]).toBeGreaterThanOrEqual(m[center]);
          }
        }
      }
    }
  });

  it('hits the configured targetRTP exactly (closed form)', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISK_LEVELS) {
        const probs = binomialProbabilities(rows);
        const mults = generateMultipliers(rows, risk, DEFAULT_TARGET_RTP);
        const ev = probs.reduce((s, p, k) => s + p * mults[k], 0);
        expect(ev).toBeCloseTo(DEFAULT_TARGET_RTP, 10);
      }
    }
  });

  it('respects custom targetRTP', () => {
    for (const target of [0.5, 0.7, 0.9, 0.95]) {
      const probs = binomialProbabilities(12);
      const mults = generateMultipliers(12, 'medium', target);
      const ev = probs.reduce((s, p, k) => s + p * mults[k], 0);
      expect(ev).toBeCloseTo(target, 10);
    }
  });

  it('higher risk = bigger spread between center and edge', () => {
    for (const rows of PLINKO_ROWS) {
      const low = generateMultipliers(rows, 'low');
      const med = generateMultipliers(rows, 'medium');
      const hi = generateMultipliers(rows, 'high');
      const lowSpread = low[0] / low[Math.floor(rows / 2)];
      const medSpread = med[0] / med[Math.floor(rows / 2)];
      const hiSpread = hi[0] / hi[Math.floor(rows / 2)];
      expect(medSpread).toBeGreaterThan(lowSpread);
      expect(hiSpread).toBeGreaterThan(medSpread);
    }
  });
});

describe('expectedValue (memoized via getMultipliers)', () => {
  it('returns targetRTP for default config', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISK_LEVELS) {
        expect(expectedValue(rows, risk)).toBeCloseTo(DEFAULT_TARGET_RTP, 10);
      }
    }
  });

  it('always under 1.0 (negative EV)', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISK_LEVELS) {
        expect(expectedValue(rows, risk)).toBeLessThan(1);
      }
    }
  });

  it('Monte Carlo on low-risk converges to closed-form within 7%', () => {
    // High-risk tables have huge edge multipliers (P ≈ 1/65k for 16-row),
    // so 10k Monte-Carlo samples don't converge tightly — that's expected,
    // not a bug. We check low-risk only because its variance is bounded;
    // closed-form correctness for all risk modes is verified by the
    // "hits the configured targetRTP exactly" test above.
    for (const rows of PLINKO_ROWS) {
      const mults = getMultipliers(rows, 'low');
      const closed = expectedValue(rows, 'low');
      let total = 0;
      const N = 10_000;
      for (let i = 0; i < N; i++) {
        let slot = 0;
        for (let r = 0; r < rows; r++) if (Math.random() < 0.5) slot++;
        total += mults[slot];
      }
      const sim = total / N;
      const relErr = Math.abs(sim - closed) / closed;
      expect(relErr).toBeLessThan(0.07);
    }
  });
});

describe('isPlinkoRows / isRiskLevel', () => {
  it('accepts only 8, 12, 16', () => {
    expect(isPlinkoRows(8)).toBe(true);
    expect(isPlinkoRows(12)).toBe(true);
    expect(isPlinkoRows(16)).toBe(true);
    expect(isPlinkoRows(7)).toBe(false);
    expect(isPlinkoRows(0)).toBe(false);
  });

  it('accepts only the three risk levels', () => {
    expect(isRiskLevel('low')).toBe(true);
    expect(isRiskLevel('medium')).toBe(true);
    expect(isRiskLevel('high')).toBe(true);
    expect(isRiskLevel('insane')).toBe(false);
    expect(isRiskLevel(undefined)).toBe(false);
  });
});

describe('USDC conversion', () => {
  it('parses and formats a canonical range of bet sizes', () => {
    const cases = ['0.10', '1.00', '10.00', '1.234567'];
    for (const v of cases) {
      const units = parseUsdcToUnits(v);
      expect(units).not.toBeNull();
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

describe('formatMultiplier / multiplierColor', () => {
  const hex = /^#[0-9a-fA-F]{6}$/;

  it('formats display values without scientific notation', () => {
    expect(formatMultiplier(0.49)).toBe('0.49x');
    expect(formatMultiplier(1.27)).toBe('1.27x');
    expect(formatMultiplier(15.7)).toBe('15.7x');
    expect(formatMultiplier(118.3)).toBe('118x');
  });

  it('returns six-digit hex for the full table range', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISK_LEVELS) {
        for (const m of generateMultipliers(rows, risk)) {
          expect(multiplierColor(m)).toMatch(hex);
        }
      }
    }
  });
});
