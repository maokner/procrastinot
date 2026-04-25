// Plinko math validation. Prints rows / probs / multipliers / closed-form EV
// and a 10k Monte Carlo simulation for every (rows, riskLevel) combination,
// then asserts every EV is < 1.
//
// Usage:
//   pnpm exec tsx scripts/plinko-math.ts

import {
  DEFAULT_TARGET_RTP,
  PLINKO_ROWS,
  RISK_LEVELS,
  binomialProbabilities,
  expectedValue,
  formatMultiplier,
  getMultipliers,
  type PlinkoRows,
  type RiskLevel,
} from '../lib/plinko';

const N = 10_000;

function monteCarloEV(rows: PlinkoRows, risk: RiskLevel) {
  const mults = getMultipliers(rows, risk);
  let total = 0;
  const counts = new Array(rows + 1).fill(0);
  for (let i = 0; i < N; i++) {
    let slot = 0;
    for (let r = 0; r < rows; r++) if (Math.random() < 0.5) slot++;
    counts[slot]++;
    total += mults[slot];
  }
  return { ev: total / N, counts };
}

function fmtPct(p: number) {
  return (p * 100).toFixed(2) + '%';
}

let allOk = true;

for (const rows of PLINKO_ROWS) {
  console.log(`\n══════════════════════ rows=${rows} ══════════════════════`);
  const probs = binomialProbabilities(rows);
  for (const risk of RISK_LEVELS) {
    const mults = getMultipliers(rows, risk);
    const closedEV = expectedValue(rows, risk);
    const { ev: simEV, counts } = monteCarloEV(rows, risk);

    const ok = closedEV < 1;
    const tag = ok ? '✓' : '✗';
    if (!ok) allOk = false;

    console.log(
      `\n  ${tag} risk=${risk.padEnd(6)}   target=${DEFAULT_TARGET_RTP.toFixed(2)}   closed-form EV=${closedEV.toFixed(4)}   ${N}-sim EV=${simEV.toFixed(4)}   house edge=${((1 - closedEV) * 100).toFixed(1)}%`,
    );
    console.log('    slot |   prob   |   mult    | sim hits');
    for (let k = 0; k <= rows; k++) {
      console.log(
        `    ${String(k).padStart(4)} | ${fmtPct(probs[k]).padStart(7)} | ${formatMultiplier(mults[k]).padStart(8)} | ${counts[k]}`,
      );
    }
  }
}

console.log(
  `\n${allOk ? '✓ all EVs are negative (< 1)' : '✗ at least one EV is positive — table needs retuning'}`,
);
process.exit(allOk ? 0 : 1);
