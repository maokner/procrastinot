'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Matter from 'matter-js';
import { MULTIPLIERS, type PlinkoRows, multiplierColor, binProbability } from '@/lib/plinko';

// ─── Board constants ────────────────────────────────────────────────────────
const BOARD_W = 640;
const BOARD_H = 520;
const CENTER_X = BOARD_W / 2;
const TOP_Y = 56;
const SLOT_Y = 474;
const SLOT_H = 34;
const PEG_R = 5;
const BALL_R = 9;
// Max simultaneous balls to prevent runaway drops on slow networks
export const MAX_PLINKO_BALLS = 6;

// Physics tuning — adjust these to change feel:
// GRAVITY_Y: acceleration per tick (higher = faster falls)
// RESTITUTION: bounciness off pegs (0 = dead, 1 = perfectly elastic)
// FRICTION_AIR: air drag (higher = slower, less floaty)
const GRAVITY_Y = 0.55;
const PEG_RESTITUTION = 0.45;
const BALL_RESTITUTION = 0.30;
const BALL_FRICTION_AIR = 0.016;
const BALL_DENSITY = 0.003;
// How fast the ball is horizontally nudged toward the correct side (px/tick minimum)
const GUIDE_MIN_SPEED = 2.8;
const TARGET_ATTRACTION = 0.00045;

type BallRecord = {
  body: Matter.Body;
  path: boolean[];
  targetSlot: number;
  lastGuidedRow: number;
  landed: boolean;
  onLand: (slot: number) => void;
};

export type PlinkoBoardHandle = {
  addBall: (path: boolean[], onLand: (slot: number) => void) => boolean;
};

function pegGeometry(rows: PlinkoRows) {
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

const PlinkoBoard = forwardRef<PlinkoBoardHandle, {
  rows: PlinkoRows;
  activeSlot: number | null;
  onReady?: () => void;
}>(function PlinkoBoard({ rows, activeSlot, onReady }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const pegBodiesRef = useRef<Matter.Body[]>([]);
  const ballsRef = useRef<BallRecord[]>([]);
  const rafRef = useRef<number>(0);
  // Refs for values read in the rAF loop (avoids stale closures from re-renders)
  const activeSlotRef = useRef(activeSlot);
  const hoveredSlotRef = useRef<number | null>(null);
  // State only for the hover info bar (needs re-render)
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);

  useEffect(() => { activeSlotRef.current = activeSlot; }, [activeSlot]);
  useEffect(() => { hoveredSlotRef.current = hoveredSlot; }, [hoveredSlot]);

  // ── Engine lifecycle — recreated when `rows` changes ─────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Tear down any previous engine
    if (engineRef.current) {
      Matter.Events.off(engineRef.current, 'beforeUpdate');
      Matter.Engine.clear(engineRef.current);
      engineRef.current = null;
    }
    ballsRef.current = [];

    const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY_Y } });
    engineRef.current = engine;

    const { gap, rowGap, pegs } = pegGeometry(rows);

    // Static peg bodies
    const pegBodies = pegs.map(({ x, y }) =>
      Matter.Bodies.circle(x, y, PEG_R, {
        isStatic: true,
        restitution: PEG_RESTITUTION,
        friction: 0.05,
        label: 'peg',
      }),
    );
    pegBodiesRef.current = pegBodies;

    // Invisible walls (slightly inside board edges so ball stays visible)
    const wallOpts = { isStatic: true, restitution: 0.2, friction: 0.1, label: 'wall' };
    const walls = [
      Matter.Bodies.rectangle(22, BOARD_H / 2, 44, BOARD_H * 2, wallOpts),
      Matter.Bodies.rectangle(BOARD_W - 22, BOARD_H / 2, 44, BOARD_H * 2, wallOpts),
      Matter.Bodies.rectangle(BOARD_W / 2, BOARD_H + 22, BOARD_W, 44, wallOpts),
    ];

    Matter.World.add(engine.world, [...pegBodies, ...walls]);

    // ── Per-tick ball guidance ────────────────────────────────────────────
    Matter.Events.on(engine, 'beforeUpdate', () => {
      const now = performance.now();

      for (const ball of ballsRef.current) {
        if (ball.landed) continue;
        const { x, y } = ball.body.position;
        const targetX = CENTER_X + (2 * ball.targetSlot - rows) * (gap / 2);

        // Landing: ball reached slot area
        if (y >= SLOT_Y - BALL_R) {
          ball.landed = true;
          ball.onLand(ball.targetSlot);
          // Let ball bounce visually for 500ms then remove
          setTimeout(() => {
            if (engineRef.current) Matter.World.remove(engineRef.current.world, ball.body);
          }, 500);
          continue;
        }

        // Guidance: one velocity correction per row zone
        const gapIndex = Math.floor((y - TOP_Y) / rowGap);
        if (
          gapIndex >= 0 &&
          gapIndex < ball.path.length &&
          gapIndex !== ball.lastGuidedRow
        ) {
          ball.lastGuidedRow = gapIndex;
          const dir = ball.path[gapIndex] ? 1 : -1;
          const vx = ball.body.velocity.x;
          // Preserve speed, correct direction
          const newVx = dir * Math.max(Math.abs(vx), GUIDE_MIN_SPEED);
          Matter.Body.setVelocity(ball.body, { x: newVx, y: ball.body.velocity.y });
        }

        // A tiny attraction keeps the physical landing aligned with the
        // server-selected bin without drawing a fake path through pegs.
        if (y > SLOT_Y - rowGap * 2.5) {
          Matter.Body.applyForce(ball.body, ball.body.position, {
            x: (targetX - x) * TARGET_ATTRACTION * ball.body.mass,
            y: 0,
          });
        }
      }

      // GC balls that fell below board
      ballsRef.current = ballsRef.current.filter((b) => {
        if (b.body.position.y > BOARD_H + 60) {
          Matter.World.remove(engine.world, b.body);
          return false;
        }
        return true;
      });

      void now; // suppress unused var warning
    });

    // ── Canvas render loop ────────────────────────────────────────────────
    const multipliers = MULTIPLIERS[rows];
    const slotWidth = gap;
    let prevTs = 0;

    function draw(ts: number) {
      if (!ctx) return;
      const dt = prevTs ? Math.min(ts - prevTs, 50) : 1000 / 60;
      prevTs = ts;
      Matter.Engine.update(engine, dt);

      ctx.clearRect(0, 0, BOARD_W, BOARD_H);
      ctx.fillStyle = '#f9f9f6';
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);

      // Top and bottom guide lines
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(36, 42); ctx.lineTo(604, 42);
      ctx.moveTo(36, 468); ctx.lineTo(604, 468);
      ctx.stroke();

      // Slot bins
      const activeSl = activeSlotRef.current;
      const hovSl = hoveredSlotRef.current;
      for (let i = 0; i <= rows; i++) {
        const sx = CENTER_X + (2 * i - rows) * (slotWidth / 2);
        const isActive = activeSl === i;
        const isHov = hovSl === i;

        ctx.beginPath();
        ctx.rect(sx - slotWidth / 2 + 2, SLOT_Y, slotWidth - 4, SLOT_H);
        ctx.fillStyle = isActive
          ? '#111111'
          : isHov
          ? 'rgba(0,0,0,0.12)'
          : 'rgba(0,0,0,0.05)';
        ctx.fill();
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 1;
        ctx.stroke();

        const fontSize = rows === 16 ? 9 : rows === 12 ? 10 : 12;
        ctx.fillStyle = isActive ? '#f9f9f6' : multiplierColor(multipliers[i]);
        ctx.font = `bold ${fontSize}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(`${multipliers[i]}x`, sx, SLOT_Y + 22);
      }

      // Pegs
      for (const peg of pegBodiesRef.current) {
        ctx.beginPath();
        ctx.arc(peg.position.x, peg.position.y, PEG_R, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(20,20,20,0.85)';
        ctx.fill();
      }

      // Balls
      for (const ball of ballsRef.current) {
        const { x, y } = ball.body.position;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ball.body.angle);
        ctx.beginPath();
        ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    onReady?.();

    return () => {
      cancelAnimationFrame(rafRef.current);
      Matter.Events.off(engine, 'beforeUpdate');
      Matter.Engine.clear(engine);
      engineRef.current = null;
      ballsRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // ── Expose addBall ────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    addBall(path: boolean[], onLand: (slot: number) => void): boolean {
      const engine = engineRef.current;
      if (!engine) return false;
      if (ballsRef.current.length >= MAX_PLINKO_BALLS) return false;

      const targetSlot = path.filter(Boolean).length;
      const jitter = (Math.random() - 0.5) * 8;
      const body = Matter.Bodies.circle(CENTER_X + jitter, TOP_Y - BALL_R * 2, BALL_R, {
        restitution: BALL_RESTITUTION,
        friction: 0.02,
        frictionAir: BALL_FRICTION_AIR,
        density: BALL_DENSITY,
        label: 'ball',
      });
      // Tiny initial push toward path[0] direction so first peg hit looks natural
      const initDir = path[0] ? 1 : -1;
      Matter.Body.setVelocity(body, { x: initDir * 0.8, y: 0.5 });

      Matter.World.add(engine.world, body);
      ballsRef.current.push({
        body,
        path,
        targetSlot,
        lastGuidedRow: -1,
        landed: false,
        onLand,
      });
      return true;
    },
  }), []);

  // ── Hover detection ───────────────────────────────────────────────────────
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (BOARD_W / rect.width);
    const my = (e.clientY - rect.top) * (BOARD_H / rect.height);

    if (my >= SLOT_Y && my <= SLOT_Y + SLOT_H) {
      const gap = 560 / rows;
      const leftEdge = CENTER_X - (rows * gap) / 2;
      const idx = Math.round((mx - leftEdge) / gap);
      if (idx >= 0 && idx <= rows) {
        setHoveredSlot(idx);
        return;
      }
    }
    setHoveredSlot(null);
  }

  const hInfo =
    hoveredSlot !== null
      ? {
          slot: hoveredSlot,
          prob: binProbability(rows, hoveredSlot),
          mult: MULTIPLIERS[rows][hoveredSlot],
        }
      : null;

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={BOARD_W}
        height={BOARD_H}
        className="aspect-[640/520] w-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredSlot(null)}
      />
      <div className="flex h-6 items-center justify-center font-mono text-xs text-[var(--ink-2)]">
        {hInfo ? (
          <span>
            Slot {hInfo.slot} · P: {(hInfo.prob * 100).toFixed(2)}% · Payout: {hInfo.mult}x
          </span>
        ) : (
          <span className="opacity-40">hover a bin to see odds</span>
        )}
      </div>
    </div>
  );
});

export default PlinkoBoard;
