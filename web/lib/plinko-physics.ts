// Geometry + animation tunables shared by the renderer (PlinkoBoard) and
// any debug script. The slot outcome is decided by the math engine in
// lib/plinko.ts — these constants only affect the visual ball animation.

import type { PlinkoRows } from './plinko';

// Engine
export const FIXED_DT_MS = 1000 / 60;
export const MAX_SIM_STEPS = 800; // safety cap — only used by debug scripts

// Animation tunables (used by the live PlinkoBoard renderer)
export const GRAVITY_Y = 0.85;
export const PEG_RESTITUTION = 0.5;
export const BALL_RESTITUTION = 0.35;
export const BALL_FRICTION_AIR = 0.012;
export const BALL_DENSITY = 0.003;

// Guidance constants for path-driven balls.
export const GUIDE_MIN_SPEED = 3.4;
export const TARGET_ATTRACTION = 0.0009;

// Cleanup thresholds
export const STUCK_MIN_SPEED_SQ = 0.5 * 0.5;
export const STUCK_TIMEOUT_MS = 1500;
export const MAX_BALL_LIFETIME_MS = 8000;

// Collision categories — keeps balls from piling up on each other.
export const CAT_PEG = 0x0001;
export const CAT_WALL = 0x0002;
export const CAT_BALL = 0x0004;

export type Geometry = {
  boardW: number;
  boardH: number;
  centerX: number;
  topY: number;
  pegSpan: number; // total horizontal span of the bottom row of pegs
  rowGap: number; // vertical pixels between adjacent peg rows
  gap: number; // horizontal pixels between adjacent pegs in the same row
  pegR: number;
  ballR: number;
  slotY: number; // y at which buckets start (top of bucket box)
  slotH: number; // bucket height
};

// Per-row geometry. 16-row gets a wider board with slightly smaller pegs/balls
// so the cone has room to breathe and balls visibly drop into buckets without
// being squeezed against pegs.
export function getBoardGeometry(rows: PlinkoRows): Geometry {
  const boardW = 720;
  const boardH = 760;
  const centerX = boardW / 2;
  const topY = 50;
  const slotY = 700;
  const slotH = 44;
  const pegSpan = 600;
  const gap = pegSpan / rows;
  // 30 px breathing room between the last peg row and the bucket lip.
  const rowGap = (slotY - topY - 30) / rows;
  const pegR = rows === 16 ? 4 : rows === 12 ? 5 : 6;
  const ballR = rows === 16 ? 7 : rows === 12 ? 8 : 9;
  return {
    boardW,
    boardH,
    centerX,
    topY,
    pegSpan,
    rowGap,
    gap,
    pegR,
    ballR,
    slotY,
    slotH,
  };
}

/** All peg positions for a given board. Pyramid: row r has r+1 pegs. */
export function pegLayout(
  rows: PlinkoRows,
  geo: Geometry = getBoardGeometry(rows),
): { x: number; y: number }[] {
  const pegs: { x: number; y: number }[] = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 0; c <= r; c++) {
      pegs.push({
        x: geo.centerX + (2 * c - r) * (geo.gap / 2),
        y: geo.topY + r * geo.rowGap,
      });
    }
  }
  return pegs;
}

/** X-coordinate of bucket k (k in [0..rows]). Buckets line up with the
 * bottom row of pegs so the ball's final x maps cleanly to bucket index. */
export function bucketCenterX(
  slot: number,
  rows: PlinkoRows,
  geo: Geometry = getBoardGeometry(rows),
): number {
  return geo.centerX + (2 * slot - rows) * (geo.gap / 2);
}

export function slotForX(
  x: number,
  rows: PlinkoRows,
  geo: Geometry = getBoardGeometry(rows),
): number {
  const leftEdge = geo.centerX - (rows * geo.gap) / 2;
  const idx = Math.round((x - leftEdge) / geo.gap);
  return Math.max(0, Math.min(rows, idx));
}

// Mulberry32 — small fast PRNG. Useful for seeded debug scripts.
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
