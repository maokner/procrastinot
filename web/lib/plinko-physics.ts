// Shared physics + geometry constants used by the live client board AND
// the server-side simulation that pre-computes a ball's trajectory. Keeping
// one source of truth here is what guarantees the recorded path lines up
// with the client's pegs / buckets / ball radius.

import type { PlinkoRows } from './plinko';

// Board dimensions (canvas pixels)
export const BOARD_W = 640;
export const BOARD_H = 520;
export const CENTER_X = BOARD_W / 2;
export const TOP_Y = 56;
export const SLOT_Y = 474;
export const SLOT_H = 34;
export const PEG_R = 5;
export const BALL_R = 9;

// Engine
export const GRAVITY_Y = 0.55;
export const FIXED_DT_MS = 1000 / 60;
export const MAX_SIM_STEPS = 600; // 10 seconds @ 60fps — safety cap

// Collision categories so balls never collide with each other.
export const CAT_PEG = 0x0001;
export const CAT_WALL = 0x0002;
export const CAT_BALL = 0x0004;

// Pylinko-faithful per-ball physics for the production board / pure-mode
// demo balls. Bouncier than the legacy guided ball.
export const PURE_BALL_OPTIONS = {
  restitution: 0.65,
  friction: 0.5,
  frictionAir: 0.004,
  density: 0.003,
} as const;

export const PEG_OPTIONS = {
  isStatic: true,
  restitution: 0.45,
  friction: 0.05,
  label: 'peg',
} as const;

export const WALL_OPTIONS = {
  isStatic: true,
  restitution: 0.2,
  friction: 0.1,
  label: 'wall',
} as const;

export function pegGeometry(rows: PlinkoRows) {
  const gap = 560 / rows;
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
  return { gap, rowGap, pegs };
}

export function slotForX(x: number, rows: PlinkoRows): number {
  const { gap } = pegGeometry(rows);
  const leftEdge = CENTER_X - (rows * gap) / 2;
  const idx = Math.round((x - leftEdge) / gap);
  return Math.max(0, Math.min(rows, idx));
}

// Mulberry32 — small fast PRNG. Same implementation server- and client-side
// so the simulation is deterministic given a seed.
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

// Derive a 32-bit seed from the first four bytes of an HMAC digest.
export function seedFromBytes(bytes: Uint8Array): number {
  return (
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  );
}
