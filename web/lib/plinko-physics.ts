// Plinko physics + geometry. The sim is pure Matter.js — no guidance, no
// attractor. The ball lands wherever physics decides; the bucket index is
// read from collision sensors at the bottom of the board.
//
// Physics tunables follow the kayooliveira/plinko-game pattern (super-
// elastic balls, per-ball randomized restitution/friction, heavy air drag),
// scaled up for a 720×760 logical canvas.

import type { PlinkoRows } from './plinko';

// Engine
export const FIXED_DT_MS = 1000 / 60;
export const MAX_SIM_STEPS = 1200; // safety cap; long enough for a slow ball
export const GRAVITY_Y = 1.0;

// Per-ball physics — randomized inside these bands so each drop plays
// differently. Restitution > 1 is super-elastic (gains energy on bounce);
// it produces lively cascading falls combined with the heavy air drag.
export const BALL_RESTITUTION_MIN = 0.95;
export const BALL_RESTITUTION_MAX = 1.25;
export const BALL_FRICTION_MIN = 0.55;
export const BALL_FRICTION_MAX = 0.8;
export const BALL_FRICTION_AIR = 0.055;
export const BALL_DENSITY = 0.005;

// Static body parameters
export const PEG_RESTITUTION = 0.5;
export const WALL_RESTITUTION = 0.2;

// Collision categories
export const CAT_PEG = 0x0001;
export const CAT_WALL = 0x0002;
export const CAT_BALL = 0x0004;
export const CAT_BUCKET = 0x0008;

export type Geometry = {
  boardW: number;
  boardH: number;
  centerX: number;
  topY: number;
  pegSpan: number; // total horizontal span of bottom-row pegs
  rowGap: number;
  pegGap: number;
  pegR: number;
  ballR: number;
  bucketY: number; // y-center of bucket sensor row
  bucketH: number;
  spawnYOffset: number; // ball spawned this many px above topY
  spawnJitter: number; // ±jitter from canvas center for ball spawn x
};

// Galton layout: row r (1..n) has r pegs. Bottom row has `rows` pegs and
// `rows+1` buckets between/beside them. The ball spawns above the single
// top peg and cascades down `rows` decision rows.
export function getBoardGeometry(rows: PlinkoRows): Geometry {
  const boardW = 720;
  const boardH = 760;
  const centerX = boardW / 2;
  // pegGap controls cone width. Smaller = tighter cone, more central
  // outcomes. We keep ball-to-gap ratio ~0.25 (kayoo's value).
  const pegGap = rows === 16 ? 32 : rows === 12 ? 42 : 56;
  const pegSpan = pegGap * (rows - 1);
  const rowGap = rows === 16 ? 36 : rows === 12 ? 46 : 60;
  const pegR = rows === 16 ? 4 : rows === 12 ? 5 : 6;
  const ballR = rows === 16 ? 7 : rows === 12 ? 8 : 9;
  const topY = 80;
  const bucketY = topY + rows * rowGap + 60;
  const bucketH = 32;
  return {
    boardW,
    boardH,
    centerX,
    topY,
    pegSpan,
    rowGap,
    pegGap,
    pegR,
    ballR,
    bucketY,
    bucketH,
    spawnYOffset: 30,
    spawnJitter: 2.5,
  };
}

/** Galton-board peg layout: row r has r pegs. */
export function pegLayout(
  rows: PlinkoRows,
  geo: Geometry = getBoardGeometry(rows),
): { x: number; y: number }[] {
  const pegs: { x: number; y: number }[] = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 0; c < r; c++) {
      pegs.push({
        x: geo.centerX + (2 * c - (r - 1)) * (geo.pegGap / 2),
        y: geo.topY + r * geo.rowGap,
      });
    }
  }
  return pegs;
}

/** Bucket center x for slot k in [0..rows]. Buckets sit between adjacent
 * bottom-row pegs (and against the walls at the extremes). */
export function bucketCenterX(
  slot: number,
  rows: PlinkoRows,
  geo: Geometry = getBoardGeometry(rows),
): number {
  return geo.centerX + (2 * slot - rows) * (geo.pegGap / 2);
}

// Mulberry32 — fast deterministic PRNG seeded from HMAC bytes so the same
// (serverSeed, clientSeed, nonce) always produces the same drop.
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromBytes(bytes: Uint8Array): number {
  return (
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  );
}
