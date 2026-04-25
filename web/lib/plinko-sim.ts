// Server-side Plinko simulation. Pure physics — no path predetermination,
// no guidance. The ball's restitution and friction are seeded per-drop so
// the same (serverSeed, clientSeed, nonce) reproduces the exact trajectory
// (provably-fair). The renderer replays the recorded trajectory client-side.

import Matter from 'matter-js';
import type { PlinkoRows } from './plinko';
import {
  BALL_DENSITY,
  BALL_FRICTION_AIR,
  BALL_FRICTION_MAX,
  BALL_FRICTION_MIN,
  BALL_RESTITUTION_MAX,
  BALL_RESTITUTION_MIN,
  CAT_BALL,
  CAT_BUCKET,
  CAT_PEG,
  CAT_WALL,
  FIXED_DT_MS,
  GRAVITY_Y,
  MAX_SIM_STEPS,
  PEG_RESTITUTION,
  WALL_RESTITUTION,
  bucketCenterX,
  getBoardGeometry,
  mulberry32,
  pegLayout,
  seedFromBytes,
  type Geometry,
} from './plinko-physics';

export type Trajectory = number[][]; // [[x, y], ...] one entry per fixed step
export type PegHit = { frame: number; x: number; y: number };

export type SimulationResult = {
  slot: number;
  trajectory: Trajectory;
  pegHits: PegHit[];
  ballRestitution: number;
  ballFriction: number;
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function simulatePlinko(
  seedBytes: Uint8Array,
  rows: PlinkoRows,
  geo: Geometry = getBoardGeometry(rows),
): SimulationResult {
  const rng = mulberry32(seedFromBytes(seedBytes));

  // Patch Matter.Common.random for the run so any internal RNG flows
  // through our seeded PRNG. Restored on exit.
  const originalRandom = Matter.Common.random;
  Matter.Common.random = ((min = 0, max = 1) =>
    min + (max - min) * rng()) as typeof Matter.Common.random;

  // Per-ball physics — sampled from the seed so every drop plays differently
  // but (serverSeed, clientSeed, nonce) determines the result.
  const ballRestitution = lerp(BALL_RESTITUTION_MIN, BALL_RESTITUTION_MAX, rng());
  const ballFriction = lerp(BALL_FRICTION_MIN, BALL_FRICTION_MAX, rng());
  const spawnDX = (rng() - 0.5) * geo.spawnJitter * 2;

  try {
    const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY_Y } });
    engine.enableSleeping = false;

    const pegs = pegLayout(rows, geo);
    const pegBodies = pegs.map(({ x, y }) =>
      Matter.Bodies.circle(x, y, geo.pegR, {
        isStatic: true,
        restitution: PEG_RESTITUTION,
        friction: 0.05,
        label: 'peg',
        collisionFilter: { category: CAT_PEG, mask: CAT_BALL },
      }),
    );

    const wallOpts = {
      isStatic: true,
      restitution: WALL_RESTITUTION,
      friction: 0.1,
      label: 'wall',
      collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
    };
    const wallInset = 18;
    const walls = [
      Matter.Bodies.rectangle(
        wallInset,
        geo.boardH / 2,
        36,
        geo.boardH * 2,
        wallOpts,
      ),
      Matter.Bodies.rectangle(
        geo.boardW - wallInset,
        geo.boardH / 2,
        36,
        geo.boardH * 2,
        wallOpts,
      ),
    ];

    // Bucket sensors — thin rectangles that only mark which slot the ball
    // ends up in. Buckets don't bounce the ball; the ball passes through
    // them and we record the first sensor it overlaps.
    const bucketBodies: Matter.Body[] = [];
    for (let k = 0; k <= rows; k++) {
      const bx = bucketCenterX(k, rows, geo);
      const body = Matter.Bodies.rectangle(
        bx,
        geo.bucketY,
        Math.max(2, geo.pegGap - 4),
        geo.bucketH,
        {
          isStatic: true,
          isSensor: true,
          label: `bucket-${k}`,
          collisionFilter: { category: CAT_BUCKET, mask: CAT_BALL },
        },
      );
      bucketBodies.push(body);
    }

    // Walls between buckets (so a ball that lands on the boundary doesn't
    // skip slots). Thin and short — only the last few px of the board.
    const dividerBodies: Matter.Body[] = [];
    const divTop = geo.bucketY - geo.bucketH / 2 - 8;
    const divBot = geo.bucketY + geo.bucketH / 2;
    for (let k = 0; k <= rows + 1; k++) {
      const dx = geo.centerX + (2 * k - rows - 1) * (geo.pegGap / 2);
      dividerBodies.push(
        Matter.Bodies.rectangle(dx, (divTop + divBot) / 2, 2, divBot - divTop, {
          isStatic: true,
          restitution: WALL_RESTITUTION,
          friction: 0.1,
          label: 'divider',
          collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
        }),
      );
    }

    Matter.World.add(engine.world, [
      ...pegBodies,
      ...walls,
      ...bucketBodies,
      ...dividerBodies,
    ]);

    const ball = Matter.Bodies.circle(
      geo.centerX + spawnDX,
      geo.topY - geo.spawnYOffset,
      geo.ballR,
      {
        restitution: ballRestitution,
        friction: ballFriction,
        frictionAir: BALL_FRICTION_AIR,
        density: BALL_DENSITY,
        label: 'ball',
        collisionFilter: { category: CAT_BALL, mask: CAT_PEG | CAT_WALL | CAT_BUCKET },
      },
    );
    Matter.World.add(engine.world, ball);

    const trajectory: Trajectory = [];
    const pegHits: PegHit[] = [];
    let landedSlot = -1;
    let frame = 0;

    Matter.Events.on(engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const a = pair.bodyA.label;
        const b = pair.bodyB.label;
        if (a === 'peg' || b === 'peg') {
          const peg = a === 'peg' ? pair.bodyA : pair.bodyB;
          pegHits.push({ frame, x: peg.position.x, y: peg.position.y });
        }
        if (landedSlot < 0) {
          for (const lab of [a, b]) {
            if (lab.startsWith('bucket-')) {
              landedSlot = Number(lab.slice('bucket-'.length));
              return;
            }
          }
        }
      }
    });

    while (frame < MAX_SIM_STEPS) {
      Matter.Engine.update(engine, FIXED_DT_MS);
      const x = Math.round(ball.position.x * 10) / 10;
      const y = Math.round(ball.position.y * 10) / 10;
      trajectory.push([x, y]);
      frame++;
      if (landedSlot >= 0) break;
      // Hard stop: ball cleared the bucket row vertically without hitting a
      // sensor (shouldn't happen, but cheap safety).
      if (y > geo.bucketY + geo.bucketH) break;
    }

    if (landedSlot < 0) {
      const finalX = trajectory[trajectory.length - 1]?.[0] ?? geo.centerX;
      const leftEdge = geo.centerX - (rows * geo.pegGap) / 2;
      landedSlot = Math.max(
        0,
        Math.min(rows, Math.round((finalX - leftEdge) / geo.pegGap)),
      );
    }

    Matter.Engine.clear(engine);

    return {
      slot: landedSlot,
      trajectory,
      pegHits,
      ballRestitution,
      ballFriction,
    };
  } finally {
    Matter.Common.random = originalRandom;
  }
}
