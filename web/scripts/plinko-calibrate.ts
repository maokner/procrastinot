// Plinko physics calibration: empirically search for settings that produce
// negative EV against the existing MULTIPLIERS table for 8, 12, and 16 rows.
//
// Usage:
//   pnpm exec tsx scripts/plinko-calibrate.ts [stage]
//     stage = "sweep" (default) | "validate"
//
// "sweep" runs 1k samples per config across a grid; "validate" runs 10k on
// the chosen final config and prints the empirical slot probabilities.

import Matter from 'matter-js';

// ── Geometry (matches lib/plinko-physics.ts) ─────────────────────────────
const BOARD_W = 640;
const BOARD_H = 520;
const CENTER_X = BOARD_W / 2;
const TOP_Y = 56;
const SLOT_Y = 474;
const PEG_R = 5;
const FIXED_DT_MS = 1000 / 60;
const MAX_SIM_STEPS = 600;
const CAT_PEG = 0x0001;
const CAT_WALL = 0x0002;
const CAT_BALL = 0x0004;

// MULTIPLIERS table from lib/plinko.ts. Don't change these — the goal is to
// find physics that produce negative EV against this fixed table.
const MULTIPLIERS: Record<8 | 12 | 16, number[]> = {
  8: [9.0, 2.0, 0.9, 0.4, 0.5, 0.4, 0.9, 2.0, 9.0],
  12: [50, 10, 2.5, 1.0, 0.7, 0.5, 0.3, 0.5, 0.7, 1.0, 2.5, 10, 50],
  16: [50, 20, 7, 3.5, 1.8, 1.1, 0.7, 0.4, 0.25, 0.4, 0.7, 1.1, 1.8, 3.5, 7, 20, 50],
};

type Rows = 8 | 12 | 16;
const ALL_ROWS: Rows[] = [8, 12, 16];

type Params = {
  ballR: number;
  ballRestitution: number;
  ballFriction: number;
  ballFrictionAir: number;
  ballDensity: number;
  pegR: number;
  pegRestitution: number;
  pegFriction: number;
  wallRestitution: number;
  wallFriction: number;
  gravityY: number;
  spawnJitter: number;
  initialVx: number;
  initialVy: number;
  pegSpan: number; // total horizontal span of bottom row of pegs
};

const baseline: Params = {
  ballR: 9,
  ballRestitution: 0.65,
  ballFriction: 0.5,
  ballFrictionAir: 0.004,
  ballDensity: 0.003,
  pegR: 5,
  pegRestitution: 0.45,
  pegFriction: 0.05,
  wallRestitution: 0.2,
  wallFriction: 0.1,
  gravityY: 0.55,
  spawnJitter: 6,
  initialVx: 0.3,
  initialVy: 0.4,
  pegSpan: 560,
};

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pegGeometry(rows: Rows, pegSpan: number) {
  const gap = pegSpan / rows;
  const rowGap = (SLOT_Y - TOP_Y - 30) / rows;
  const pegs: { x: number; y: number }[] = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 0; c <= r; c++) {
      pegs.push({
        x: CENTER_X + (2 * c - r) * (gap / 2),
        y: TOP_Y + r * rowGap,
      });
    }
  }
  return { gap, pegs };
}

function slotForX(x: number, rows: Rows, pegSpan: number): number {
  const gap = pegSpan / rows;
  const leftEdge = CENTER_X - (rows * gap) / 2;
  const idx = Math.round((x - leftEdge) / gap);
  return Math.max(0, Math.min(rows, idx));
}

function simulate(params: Params, rows: Rows, seed: number): number {
  const rng = mulberry32(seed);
  const originalRandom = Matter.Common.random;
  Matter.Common.random = ((min = 0, max = 1) =>
    min + (max - min) * rng()) as typeof Matter.Common.random;
  try {
    const engine = Matter.Engine.create({
      gravity: { x: 0, y: params.gravityY },
    });
    engine.enableSleeping = false;

    const { pegs } = pegGeometry(rows, params.pegSpan);
    const pegBodies = pegs.map(({ x, y }) =>
      Matter.Bodies.circle(x, y, params.pegR, {
        isStatic: true,
        restitution: params.pegRestitution,
        friction: params.pegFriction,
        label: 'peg',
        collisionFilter: { category: CAT_PEG, mask: CAT_BALL },
      }),
    );
    const walls = [
      Matter.Bodies.rectangle(22, BOARD_H / 2, 44, BOARD_H * 2, {
        isStatic: true,
        restitution: params.wallRestitution,
        friction: params.wallFriction,
        label: 'wall',
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
      }),
      Matter.Bodies.rectangle(BOARD_W - 22, BOARD_H / 2, 44, BOARD_H * 2, {
        isStatic: true,
        restitution: params.wallRestitution,
        friction: params.wallFriction,
        label: 'wall',
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
      }),
      Matter.Bodies.rectangle(BOARD_W / 2, BOARD_H + 22, BOARD_W, 44, {
        isStatic: true,
        restitution: params.wallRestitution,
        friction: params.wallFriction,
        label: 'wall',
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
      }),
    ];
    Matter.World.add(engine.world, [...pegBodies, ...walls]);

    const jitter = (rng() - 0.5) * params.spawnJitter * 2;
    const ball = Matter.Bodies.circle(
      CENTER_X + jitter,
      TOP_Y - params.ballR * 2,
      params.ballR,
      {
        restitution: params.ballRestitution,
        friction: params.ballFriction,
        frictionAir: params.ballFrictionAir,
        density: params.ballDensity,
        label: 'ball',
        collisionFilter: { category: CAT_BALL, mask: CAT_PEG | CAT_WALL },
      },
    );
    Matter.Body.setVelocity(ball, {
      x: (rng() - 0.5) * params.initialVx * 2,
      y: params.initialVy,
    });
    Matter.World.add(engine.world, ball);

    let frame = 0;
    let landedSlot = -1;
    while (frame < MAX_SIM_STEPS) {
      Matter.Engine.update(engine, FIXED_DT_MS);
      const x = ball.position.x;
      const y = ball.position.y;
      frame++;
      if (y >= SLOT_Y - params.ballR) {
        landedSlot = slotForX(x, rows, params.pegSpan);
        break;
      }
    }
    if (landedSlot === -1) {
      landedSlot = slotForX(ball.position.x, rows, params.pegSpan);
    }
    Matter.Engine.clear(engine);
    return landedSlot;
  } finally {
    Matter.Common.random = originalRandom;
  }
}

function runTrials(params: Params, rows: Rows, n: number) {
  const counts = new Array(rows + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const slot = simulate(params, rows, i + 1);
    counts[slot]++;
  }
  const probs = counts.map((c) => c / n);
  const ev = probs.reduce(
    (acc, p, i) => acc + p * MULTIPLIERS[rows][i],
    0,
  );
  return { counts, probs, ev };
}

function fmtPct(p: number) {
  return (p * 100).toFixed(2) + '%';
}

// ── STAGES ─────────────────────────────────────────────────────────────

function stageBaseline(samples: number) {
  console.log(`\n=== BASELINE (${samples} samples per row count) ===`);
  for (const r of ALL_ROWS) {
    const { probs, ev } = runTrials(baseline, r, samples);
    const edgeP = probs[0] + probs[r];
    console.log(
      `rows=${r} EV=${ev.toFixed(3)} edgeP=${fmtPct(edgeP)} (each end)`,
    );
  }
}

function stageSweep(samples: number) {
  console.log(`\n=== SWEEP (${samples} samples per config) ===`);

  const results: { params: Partial<Params>; evs: Record<Rows, number> }[] = [];

  // Strategy: peg restitution dominates energy retention; ball restitution
  // controls bounce magnitude; pegSpan controls how aggressively side bounces
  // push the ball into edge slots. Sweep these three together.
  const pegRSweep = [0.0, 0.1, 0.25, 0.45];
  const ballRSweep = [0.1, 0.35, 0.65];
  const spanSweep = [560, 460];

  for (const pegR of pegRSweep) {
    for (const ballR of ballRSweep) {
      for (const span of spanSweep) {
        const params: Params = {
          ...baseline,
          pegRestitution: pegR,
          ballRestitution: ballR,
          pegSpan: span,
        };
        const evs = {} as Record<Rows, number>;
        for (const r of ALL_ROWS) {
          evs[r] = runTrials(params, r, samples).ev;
        }
        const allNeg = ALL_ROWS.every((r) => evs[r] < 1);
        const tag = allNeg ? '★' : ' ';
        console.log(
          `${tag} pegR=${pegR.toFixed(2)} ballR=${ballR.toFixed(2)} span=${span} | EV: 8=${evs[8].toFixed(2)} 12=${evs[12].toFixed(2)} 16=${evs[16].toFixed(2)}`,
        );
        results.push({
          params: { pegRestitution: pegR, ballRestitution: ballR, pegSpan: span },
          evs,
        });
      }
    }
  }

  console.log('\n--- TOP CANDIDATES (negative EV across all row counts) ---');
  const winners = results.filter((r) =>
    ALL_ROWS.every((rows) => r.evs[rows] < 1),
  );
  winners.sort((a, b) => {
    // Prefer the most consistent (lowest max EV — i.e., the worst-case
    // outcome for the player is still <1, and across rows the spread is small).
    const maxA = Math.max(...ALL_ROWS.map((r) => a.evs[r]));
    const maxB = Math.max(...ALL_ROWS.map((r) => b.evs[r]));
    return maxA - maxB;
  });
  for (const w of winners.slice(0, 8)) {
    console.log(
      `  ${JSON.stringify(w.params)} → max EV ${Math.max(...ALL_ROWS.map((r) => w.evs[r])).toFixed(3)}`,
    );
  }
}

function stageValidate(params: Params, samples: number) {
  console.log(`\n=== VALIDATE (${samples} samples per row count) ===`);
  console.log('Params:', JSON.stringify(params, null, 2));
  for (const r of ALL_ROWS) {
    const { probs, ev, counts } = runTrials(params, r, samples);
    console.log(`\nrows=${r} EV=${ev.toFixed(4)} ${ev < 1 ? '✓ neg-EV' : '✗ POSITIVE EV'}`);
    console.log('  slot | prob   | mult | contrib');
    for (let i = 0; i <= r; i++) {
      const m = MULTIPLIERS[r][i];
      console.log(
        `  ${String(i).padStart(4)} | ${fmtPct(probs[i]).padStart(6)} | ${String(m).padStart(4)} | ${(probs[i] * m).toFixed(4)}  (n=${counts[i]})`,
      );
    }
  }
}

function stageSweep3(samples: number) {
  console.log(`\n=== SWEEP3 (${samples} samples per config) ===`);
  console.log('Goal: variance back while keeping EV<1. Vary spawn/initialVx/damping.');

  const results: { params: Partial<Params>; evs: Record<Rows, number>; centerFracs: Record<Rows, number> }[] = [];

  const jitterSweep = [12, 30, 60];
  const fAirSweep = [0.005, 0.015, 0.03];
  const restSweep = [0.05, 0.2, 0.4];
  const initialVxSweep = [0.3, 1.0];

  for (const jitter of jitterSweep) {
    for (const fAir of fAirSweep) {
      for (const rest of restSweep) {
        for (const ivx of initialVxSweep) {
          const params: Params = {
            ...baseline,
            spawnJitter: jitter,
            ballFrictionAir: fAir,
            ballRestitution: rest,
            initialVx: ivx,
          };
          const evs = {} as Record<Rows, number>;
          const centerFracs = {} as Record<Rows, number>;
          for (const r of ALL_ROWS) {
            const t = runTrials(params, r, samples);
            evs[r] = t.ev;
            // Fraction of balls that landed in the single center slot —
            // signal of "is this a degenerate distribution".
            centerFracs[r] = t.probs[Math.floor(r / 2)];
          }
          const allNeg = ALL_ROWS.every((r) => evs[r] < 1);
          const tag = allNeg ? '★' : ' ';
          console.log(
            `${tag} jit=${jitter} fAir=${fAir.toFixed(3)} rest=${rest.toFixed(2)} ivx=${ivx.toFixed(1)} | EV: 8=${evs[8].toFixed(2)} 12=${evs[12].toFixed(2)} 16=${evs[16].toFixed(2)} | center%: 8=${(centerFracs[8] * 100).toFixed(0)} 12=${(centerFracs[12] * 100).toFixed(0)} 16=${(centerFracs[16] * 100).toFixed(0)}`,
          );
          results.push({
            params: {
              spawnJitter: jitter,
              ballFrictionAir: fAir,
              ballRestitution: rest,
              initialVx: ivx,
            },
            evs,
            centerFracs,
          });
        }
      }
    }
  }

  console.log('\n--- BEST CANDIDATES (EV<1 AND no row >70% in center slot) ---');
  const winners = results.filter(
    (r) =>
      ALL_ROWS.every((rows) => r.evs[rows] < 1) &&
      ALL_ROWS.every((rows) => r.centerFracs[rows] < 0.7),
  );
  winners.sort((a, b) => {
    const maxA = Math.max(...ALL_ROWS.map((r) => a.evs[r]));
    const maxB = Math.max(...ALL_ROWS.map((r) => b.evs[r]));
    return maxA - maxB;
  });
  for (const w of winners.slice(0, 12)) {
    console.log(
      `  ${JSON.stringify(w.params)} → EV 8=${w.evs[8].toFixed(2)} 12=${w.evs[12].toFixed(2)} 16=${w.evs[16].toFixed(2)} | center% 8=${(w.centerFracs[8] * 100).toFixed(0)} 12=${(w.centerFracs[12] * 100).toFixed(0)} 16=${(w.centerFracs[16] * 100).toFixed(0)}`,
    );
  }
  if (winners.length === 0) {
    console.log('  (none — relaxing center cap)');
  }
}

function stageSweep2(samples: number) {
  console.log(`\n=== SWEEP2 (${samples} samples per config) ===`);
  console.log('Targeting 16-row in particular: ball/peg geometry, air drag, density.');

  const results: { params: Partial<Params>; evs: Record<Rows, number> }[] = [];

  // Levers that actually matter (peg restitution proven inert for static bodies):
  //   - ball/peg radius ratio  → tightness of the cone
  //   - frictionAir            → lateral damping
  //   - density                → inertia carrying through peg hits
  //   - ballRestitution        → peg-bounce magnitude
  const ballRSweep = [9, 11];
  const pegRSweep = [5, 7];
  const ballRestSweep = [0.0, 0.15];
  const fricAirSweep = [0.02, 0.08];
  const densitySweep = [0.003, 0.01];

  for (const ballR of ballRSweep) {
    for (const pegR of pegRSweep) {
      for (const bRest of ballRestSweep) {
        for (const fAir of fricAirSweep) {
          for (const dens of densitySweep) {
            const params: Params = {
              ...baseline,
              ballR,
              pegR,
              ballRestitution: bRest,
              ballFrictionAir: fAir,
              ballDensity: dens,
            };
            const evs = {} as Record<Rows, number>;
            for (const r of ALL_ROWS) {
              evs[r] = runTrials(params, r, samples).ev;
            }
            const allNeg = ALL_ROWS.every((r) => evs[r] < 1);
            const tag = allNeg ? '★' : ' ';
            console.log(
              `${tag} ballR=${ballR} pegR=${pegR} bRest=${bRest.toFixed(2)} fAir=${fAir.toFixed(3)} dens=${dens} | EV: 8=${evs[8].toFixed(2)} 12=${evs[12].toFixed(2)} 16=${evs[16].toFixed(2)}`,
            );
            results.push({
              params: {
                ballR,
                pegR,
                ballRestitution: bRest,
                ballFrictionAir: fAir,
                ballDensity: dens,
              },
              evs,
            });
          }
        }
      }
    }
  }

  console.log('\n--- TOP CANDIDATES (EV<1 across all rows) ---');
  const winners = results.filter((r) =>
    ALL_ROWS.every((rows) => r.evs[rows] < 1),
  );
  winners.sort((a, b) => {
    const maxA = Math.max(...ALL_ROWS.map((r) => a.evs[r]));
    const maxB = Math.max(...ALL_ROWS.map((r) => b.evs[r]));
    return maxA - maxB;
  });
  for (const w of winners.slice(0, 10)) {
    console.log(
      `  ${JSON.stringify(w.params)} → 8=${w.evs[8].toFixed(2)} 12=${w.evs[12].toFixed(2)} 16=${w.evs[16].toFixed(2)}`,
    );
  }
  if (winners.length === 0) {
    console.log('  (none — print the lowest-max-EV configs instead)');
    results.sort((a, b) => {
      const maxA = Math.max(...ALL_ROWS.map((r) => a.evs[r]));
      const maxB = Math.max(...ALL_ROWS.map((r) => b.evs[r]));
      return maxA - maxB;
    });
    for (const w of results.slice(0, 10)) {
      console.log(
        `  ${JSON.stringify(w.params)} → 8=${w.evs[8].toFixed(2)} 12=${w.evs[12].toFixed(2)} 16=${w.evs[16].toFixed(2)}`,
      );
    }
  }
}

// ── ENTRY ──────────────────────────────────────────────────────────────

const stage = process.argv[2] ?? 'sweep';

if (stage === 'baseline') {
  stageBaseline(1000);
} else if (stage === 'sweep') {
  stageBaseline(1000);
  stageSweep(1000);
} else if (stage === 'sweep2') {
  stageSweep2(500);
} else if (stage === 'sweep3') {
  stageSweep3(500);
} else if (stage === 'validate') {
  // Fill in winning params via env vars or edit before running.
  const params: Params = {
    ...baseline,
    ballR: Number(process.env.BALL_RAD ?? baseline.ballR),
    pegR: Number(process.env.PEG_RAD ?? baseline.pegR),
    ballRestitution: Number(process.env.BALL_REST ?? baseline.ballRestitution),
    ballFrictionAir: Number(
      process.env.FRIC_AIR ?? baseline.ballFrictionAir,
    ),
    ballDensity: Number(process.env.DENSITY ?? baseline.ballDensity),
    gravityY: Number(process.env.GRAVITY ?? baseline.gravityY),
    spawnJitter: Number(process.env.JITTER ?? baseline.spawnJitter),
    initialVx: Number(process.env.IVX ?? baseline.initialVx),
  };
  stageValidate(params, 10_000);
} else {
  console.error('Unknown stage:', stage);
  process.exit(1);
}
