// Server-side Plinko simulation. Runs Matter.js in Node with a seeded
// PRNG so the slot is determined by physics rather than HMAC bit-counting.
// The recorded trajectory is sent to the client for replay — no live
// physics on the client for production drops.

import Matter from 'matter-js';
import {
  BALL_R,
  BOARD_H,
  BOARD_W,
  CAT_BALL,
  CAT_PEG,
  CAT_WALL,
  CENTER_X,
  FIXED_DT_MS,
  GRAVITY_Y,
  MAX_SIM_STEPS,
  PEG_OPTIONS,
  PEG_R,
  PURE_BALL_OPTIONS,
  SLOT_Y,
  TOP_Y,
  WALL_OPTIONS,
  mulberry32,
  pegGeometry,
  seedFromBytes,
  slotForX,
} from './plinko-physics';
import type { PlinkoRows } from './plinko';

export type Trajectory = number[][]; // [[x, y], ...] one entry per fixed step
export type PegHit = { frame: number; x: number; y: number };

export type SimulationResult = {
  slot: number;
  trajectory: Trajectory;
  pegHits: PegHit[];
};

export function simulatePlinko(
  seedBytes: Uint8Array,
  rows: PlinkoRows,
): SimulationResult {
  const rng = mulberry32(seedFromBytes(seedBytes));

  // Patch Matter.Common.random for the duration of this call so any internal
  // randomness flows through our seeded PRNG. Restore on exit.
  const originalRandom = Matter.Common.random;
  Matter.Common.random = ((min = 0, max = 1) => min + (max - min) * rng()) as
    typeof Matter.Common.random;

  try {
    const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY_Y } });
    // Disable sleeping so a slow-moving ball doesn't get parked mid-air.
    engine.enableSleeping = false;

    const { gap, pegs } = pegGeometry(rows);

    const pegBodies = pegs.map(({ x, y }) =>
      Matter.Bodies.circle(x, y, PEG_R, {
        ...PEG_OPTIONS,
        collisionFilter: { category: CAT_PEG, mask: CAT_BALL },
      }),
    );
    const walls = [
      Matter.Bodies.rectangle(22, BOARD_H / 2, 44, BOARD_H * 2, {
        ...WALL_OPTIONS,
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
      }),
      Matter.Bodies.rectangle(BOARD_W - 22, BOARD_H / 2, 44, BOARD_H * 2, {
        ...WALL_OPTIONS,
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
      }),
      Matter.Bodies.rectangle(BOARD_W / 2, BOARD_H + 22, BOARD_W, 44, {
        ...WALL_OPTIONS,
        collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
      }),
    ];
    Matter.World.add(engine.world, [...pegBodies, ...walls]);

    // Spawn jitter and initial-velocity ranges are calibrated together with
    // PURE_BALL_OPTIONS — see scripts/plinko-calibrate.ts. Half-width 60px
    // of horizontal jitter and ±1.0 of initial Vx give enough variance for
    // 16-row to produce a non-degenerate distribution while keeping EV<1.
    const jitter = (rng() - 0.5) * 120;
    const ball = Matter.Bodies.circle(
      CENTER_X + jitter,
      TOP_Y - BALL_R * 2,
      BALL_R,
      {
        ...PURE_BALL_OPTIONS,
        label: 'ball',
        collisionFilter: { category: CAT_BALL, mask: CAT_PEG | CAT_WALL },
      },
    );
    Matter.Body.setVelocity(ball, {
      x: (rng() - 0.5) * 2.0,
      y: 0.4,
    });
    Matter.World.add(engine.world, ball);

    const trajectory: Trajectory = [];
    const pegHits: PegHit[] = [];
    let frame = 0;

    Matter.Events.on(engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const peg =
          pair.bodyA.label === 'peg'
            ? pair.bodyA
            : pair.bodyB.label === 'peg'
              ? pair.bodyB
              : null;
        if (peg) {
          pegHits.push({ frame, x: peg.position.x, y: peg.position.y });
        }
      }
    });

    let landedSlot = -1;
    while (frame < MAX_SIM_STEPS) {
      Matter.Engine.update(engine, FIXED_DT_MS);
      // Round to one decimal to keep the JSON payload tight without losing
      // sub-pixel motion.
      const x = Math.round(ball.position.x * 10) / 10;
      const y = Math.round(ball.position.y * 10) / 10;
      trajectory.push([x, y]);
      frame++;
      if (y >= SLOT_Y - BALL_R) {
        landedSlot = slotForX(x, rows);
        break;
      }
    }

    if (landedSlot === -1) {
      // Safety: simulation exhausted MAX_SIM_STEPS. Snap to nearest slot.
      const [fx, fy] = trajectory[trajectory.length - 1] ?? [CENTER_X, SLOT_Y];
      void fy;
      landedSlot = slotForX(fx, rows);
    }

    void gap;
    Matter.Engine.clear(engine);

    return { slot: landedSlot, trajectory, pegHits };
  } finally {
    Matter.Common.random = originalRandom;
  }
}
