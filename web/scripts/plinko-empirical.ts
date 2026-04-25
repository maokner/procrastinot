// Run the production server-side simulation N times for each row count,
// print the empirical bucket distribution, then derive a multiplier table
// such that EV against the empirical distribution = targetRTP.
//
// Usage:
//   pnpm exec tsx scripts/plinko-empirical.ts            # 10k samples
//   N=50000 pnpm exec tsx scripts/plinko-empirical.ts    # custom

import { randomBytes } from 'crypto';
import { PLINKO_ROWS, type PlinkoRows } from '../lib/plinko';
import { simulatePlinko } from '../lib/plinko-sim';

const N = Number(process.env.N ?? 10_000);
const TARGET_RTP = 0.7;

function fmtPct(p: number): string {
  return (p * 100).toFixed(2) + '%';
}

type Stats = {
  rows: PlinkoRows;
  counts: number[];
  probs: number[];
};

function sample(rows: PlinkoRows): Stats {
  const counts = new Array(rows + 1).fill(0);
  for (let i = 0; i < N; i++) {
    const seedBytes = randomBytes(32);
    const r = simulatePlinko(seedBytes, rows);
    counts[r.slot]++;
  }
  return {
    rows,
    counts,
    probs: counts.map((c) => c / N),
  };
}

// Generator: same shape as the binomial paytable generator, but driven by
// the empirical probability vector. mult[k] ∝ (P_center / P_k)^alpha; we
// then scale so EV = targetRTP.
function generateFromDistribution(
  probs: number[],
  alpha: number,
  targetRTP: number,
): number[] {
  const center = Math.floor((probs.length - 1) / 2);
  const centerProb = probs[center] || 1e-9;
  const raw = probs.map((p) => Math.pow(centerProb / Math.max(p, 1e-9), alpha));
  // Symmetrize against zeros — if one tail never landed in N samples, mirror
  // the other tail's (raw, prob) pair so the table is still symmetric.
  for (let k = 0; k <= center; k++) {
    const j = probs.length - 1 - k;
    const symRaw = (raw[k] + raw[j]) / 2;
    raw[k] = symRaw;
    raw[j] = symRaw;
    const symProb = (probs[k] + probs[j]) / 2;
    probs[k] = symProb;
    probs[j] = symProb;
  }
  const evRaw = raw.reduce((s, m, k) => s + probs[k] * m, 0);
  const scale = targetRTP / evRaw;
  return raw.map((m) => m * scale);
}

function fmtMult(m: number): string {
  if (m >= 100) return `${Math.round(m)}x`;
  if (m >= 10) return `${m.toFixed(1)}x`;
  if (m >= 1) return `${m.toFixed(2)}x`;
  return `${m.toFixed(3)}x`;
}

const ALPHAS = { low: 0.35, medium: 0.55, high: 0.8 } as const;

console.log(`\nSampling pure-physics Plinko (${N} drops per row count)…`);

for (const rows of PLINKO_ROWS) {
  const t0 = Date.now();
  const stats = sample(rows);
  const t = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\n══════════════════════ rows=${rows}  (${t}s for ${N} drops) ══════════════════════`,
  );
  console.log('  slot |  prob   | hits');
  for (let k = 0; k <= rows; k++) {
    console.log(
      `  ${String(k).padStart(4)} | ${fmtPct(stats.probs[k]).padStart(7)} | ${stats.counts[k]}`,
    );
  }

  for (const [risk, alpha] of Object.entries(ALPHAS) as Array<[keyof typeof ALPHAS, number]>) {
    const probsCopy = [...stats.probs];
    const mults = generateFromDistribution(probsCopy, alpha, TARGET_RTP);
    const ev = probsCopy.reduce((s, p, k) => s + p * mults[k], 0);
    const ok = ev < 1;
    console.log(
      `\n  ${ok ? '✓' : '✗'} risk=${risk.padEnd(6)} alpha=${alpha} EV=${ev.toFixed(4)}  (target ${TARGET_RTP.toFixed(2)})`,
    );
    console.log('    slot |  prob   |  mult    | contrib');
    for (let k = 0; k <= rows; k++) {
      const contrib = probsCopy[k] * mults[k];
      console.log(
        `    ${String(k).padStart(4)} | ${fmtPct(probsCopy[k]).padStart(7)} | ${fmtMult(mults[k]).padStart(8)} | ${contrib.toFixed(4)}`,
      );
    }
  }
}
