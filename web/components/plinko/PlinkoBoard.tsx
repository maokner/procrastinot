'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import Matter from 'matter-js';
import {
  MULTIPLIERS,
  type PlinkoRows,
  binProbability,
  multiplierColor,
} from '@/lib/plinko';
import {
  isMuted,
  playBucketLand,
  playPegHit,
  toggleMuted,
} from '@/lib/plinko-sounds';
import { FIXED_DT_MS } from '@/lib/plinko-physics';

// ─── Board dimensions ───────────────────────────────────────────────────────
const BOARD_W = 640;
const BOARD_H = 520;
const CENTER_X = BOARD_W / 2;
const TOP_Y = 56;
const SLOT_Y = 474;
const SLOT_H = 34;
const PEG_R = 5;
const BALL_R = 9;

export const MAX_PLINKO_BALLS = 20;
const MAX_PAYOUT_CARDS = 5;

// ─── Physics ────────────────────────────────────────────────────────────────
const GRAVITY_Y = 0.55;
const PEG_RESTITUTION = 0.45;
const BALL_RESTITUTION = 0.30;
const BALL_FRICTION_AIR = 0.016;
const BALL_DENSITY = 0.003;
const GUIDE_MIN_SPEED = 2.8;
const TARGET_ATTRACTION = 0.00045;

// Cleanup thresholds
const STUCK_MIN_SPEED_SQ = 0.5 * 0.5;   // px/tick, squared
const STUCK_TIMEOUT_MS = 1500;
const MAX_BALL_LIFETIME_MS = 6000;

// Collision categories — keeps balls from piling up on each other.
const CAT_PEG = 0x0001;
const CAT_WALL = 0x0002;
const CAT_BALL = 0x0004;

// Visual tuning
const RING_DURATION_MS = 250;
const RING_R_FROM = PEG_R;
const RING_R_TO = 18;
const BUCKET_BOUNCE_MS = 280;
const BUCKET_BOUNCE_PX = 4;

// ─── Types ──────────────────────────────────────────────────────────────────
// path === null  → pure-physics ball (no guidance, slot derived from landing x)
// path !== null  → guided ball, locked to path.filter(Boolean).length
type BallRecord = {
  body: Matter.Body;
  path: boolean[] | null;
  targetSlot: number;
  lastGuidedRow: number;
  landed: boolean;
  spawnTs: number;
  lastMotionTs: number;
  onLand: (slot: number) => void;
};

type Ring = { x: number; y: number; t0: number };
type BucketAnim = { slot: number; t0: number };

type PlaybackBall = {
  id: number;
  trajectory: number[][]; // [[x, y], ...] one per fixed step
  pegHits: { frame: number; x: number; y: number }[];
  nextPegHitIdx: number;
  startTs: number;
  targetSlot: number; // server-authoritative
  landed: boolean;
  onLand: (slot: number) => void;
};

export type PlinkoBoardHandle = {
  addBall: (path: boolean[], onLand: (slot: number) => void) => boolean;
  addPureBall: (onLand: (slot: number) => void) => boolean;
  addPlaybackBall: (
    trajectory: number[][],
    pegHits: { frame: number; x: number; y: number }[],
    targetSlot: number,
    onLand: (slot: number) => void,
  ) => boolean;
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

type PayoutCard = {
  id: number;
  slot: number;
  multiplier: number;
};

// ─── Component ──────────────────────────────────────────────────────────────
const PlinkoBoard = forwardRef<
  PlinkoBoardHandle,
  {
    rows: PlinkoRows;
    activeSlot: number | null;
    onReady?: () => void;
  }
>(function PlinkoBoard({ rows, activeSlot, onReady }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const pegBodiesRef = useRef<Matter.Body[]>([]);
  const ballsRef = useRef<BallRecord[]>([]);
  const playbackBallsRef = useRef<PlaybackBall[]>([]);
  const ringsRef = useRef<Ring[]>([]);
  const bucketAnimsRef = useRef<BucketAnim[]>([]);
  const rafRef = useRef<number>(0);
  const activeSlotRef = useRef(activeSlot);
  const hoveredSlotRef = useRef<number | null>(null);
  const cardSeqRef = useRef(0);
  const ballSeqRef = useRef(0);

  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [payoutCards, setPayoutCards] = useState<PayoutCard[]>([]);
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    setMutedState(isMuted());
  }, []);

  function handleMuteToggle() {
    setMutedState(toggleMuted());
  }

  useEffect(() => {
    activeSlotRef.current = activeSlot;
  }, [activeSlot]);
  useEffect(() => {
    hoveredSlotRef.current = hoveredSlot;
  }, [hoveredSlot]);

  // ─── Engine lifecycle (recreated when rows change) ────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (engineRef.current) {
      Matter.Events.off(engineRef.current, 'beforeUpdate');
      Matter.Events.off(engineRef.current, 'collisionStart');
      Matter.Engine.clear(engineRef.current);
      engineRef.current = null;
    }
    ballsRef.current = [];
    playbackBallsRef.current = [];
    ringsRef.current = [];
    bucketAnimsRef.current = [];

    const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY_Y } });
    engineRef.current = engine;

    const { gap, rowGap, pegs } = pegGeometry(rows);

    const pegBodies = pegs.map(({ x, y }) =>
      Matter.Bodies.circle(x, y, PEG_R, {
        isStatic: true,
        restitution: PEG_RESTITUTION,
        friction: 0.05,
        label: 'peg',
        collisionFilter: { category: CAT_PEG, mask: CAT_BALL },
      }),
    );
    pegBodiesRef.current = pegBodies;

    const wallOpts = {
      isStatic: true,
      restitution: 0.2,
      friction: 0.1,
      label: 'wall',
      collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
    };
    const walls = [
      Matter.Bodies.rectangle(22, BOARD_H / 2, 44, BOARD_H * 2, wallOpts),
      Matter.Bodies.rectangle(BOARD_W - 22, BOARD_H / 2, 44, BOARD_H * 2, wallOpts),
      Matter.Bodies.rectangle(BOARD_W / 2, BOARD_H + 22, BOARD_W, 44, wallOpts),
    ];

    Matter.World.add(engine.world, [...pegBodies, ...walls]);

    // Spawn expanding rings + click sound where balls hit pegs.
    Matter.Events.on(engine, 'collisionStart', (event) => {
      const now = performance.now();
      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        const peg =
          bodyA.label === 'peg' ? bodyA : bodyB.label === 'peg' ? bodyB : null;
        const ball =
          bodyA.label === 'ball' ? bodyA : bodyB.label === 'ball' ? bodyB : null;
        if (peg && ball) {
          ringsRef.current.push({ x: peg.position.x, y: peg.position.y, t0: now });
          if (ringsRef.current.length > 24) {
            ringsRef.current.splice(0, ringsRef.current.length - 24);
          }
          playPegHit();
        }
      }
    });

    Matter.Events.on(engine, 'beforeUpdate', () => {
      const now = performance.now();

      for (const ball of ballsRef.current) {
        if (ball.landed) continue;
        const { x, y } = ball.body.position;
        const vx = ball.body.velocity.x;
        const vy = ball.body.velocity.y;
        const speedSq = vx * vx + vy * vy;

        if (speedSq > STUCK_MIN_SPEED_SQ) {
          ball.lastMotionTs = now;
        }

        // Landing — fires the moment the ball intersects the slot row.
        if (y >= SLOT_Y - BALL_R) {
          landBall(ball, slotForBall(ball, x), now);
          continue;
        }

        // Pure-physics balls run free: no timeouts, no guidance, no attractor.
        // They land only when they actually reach the slot line above.
        if (ball.path === null) continue;

        // Stuck-ball cleanup — guided balls only. Without this safety the
        // attractor can occasionally pin a ball against a peg corner.
        if (
          now - ball.lastMotionTs > STUCK_TIMEOUT_MS ||
          now - ball.spawnTs > MAX_BALL_LIFETIME_MS
        ) {
          landBall(ball, slotForBall(ball, x), now);
          continue;
        }

        // Per-row velocity nudge toward the correct side
        const gapIndex = Math.floor((y - TOP_Y) / rowGap);
        if (
          gapIndex >= 0 &&
          gapIndex < ball.path.length &&
          gapIndex !== ball.lastGuidedRow
        ) {
          ball.lastGuidedRow = gapIndex;
          const dir = ball.path[gapIndex] ? 1 : -1;
          const newVx = dir * Math.max(Math.abs(vx), GUIDE_MIN_SPEED);
          Matter.Body.setVelocity(ball.body, { x: newVx, y: vy });
        }

        // Soft attractor so the physical landing aligns with the target slot.
        if (y > SLOT_Y - rowGap * 2.5) {
          const targetX = CENTER_X + (2 * ball.targetSlot - rows) * (gap / 2);
          Matter.Body.applyForce(ball.body, ball.body.position, {
            x: (targetX - x) * TARGET_ATTRACTION * ball.body.mass,
            y: 0,
          });
        }
      }

      // Trim ring animations that have elapsed
      const ringCut = now - RING_DURATION_MS;
      if (ringsRef.current.length && ringsRef.current[0].t0 < ringCut) {
        ringsRef.current = ringsRef.current.filter((r) => r.t0 >= ringCut);
      }
      const bucketCut = now - BUCKET_BOUNCE_MS;
      if (
        bucketAnimsRef.current.length &&
        bucketAnimsRef.current[0].t0 < bucketCut
      ) {
        bucketAnimsRef.current = bucketAnimsRef.current.filter(
          (b) => b.t0 >= bucketCut,
        );
      }

      // GC balls that dropped off the board entirely (shouldn't happen with
      // bottom wall, but cheap safety).
      ballsRef.current = ballsRef.current.filter((b) => {
        if (b.body.position.y > BOARD_H + 60) {
          Matter.World.remove(engine.world, b.body);
          return false;
        }
        return true;
      });
    });

    function slotForBall(ball: BallRecord, x: number): number {
      // Guided ball: server already committed to a slot.
      if (ball.path !== null) return ball.targetSlot;
      // Pure ball: round to the nearest bin under the ball.
      const leftEdge = CENTER_X - (rows * gap) / 2;
      const idx = Math.round((x - leftEdge) / gap);
      return Math.max(0, Math.min(rows, idx));
    }

    function commitLanding(slot: number, now: number, onLand: (s: number) => void) {
      bucketAnimsRef.current.push({ slot, t0: now });
      const mult = MULTIPLIERS[rows][slot];
      setPayoutCards((prev) => {
        const next: PayoutCard = {
          id: ++cardSeqRef.current,
          slot,
          multiplier: mult,
        };
        return [next, ...prev].slice(0, MAX_PAYOUT_CARDS);
      });
      playBucketLand(mult);
      onLand(slot);
    }

    function landBall(ball: BallRecord, slot: number, now: number) {
      ball.landed = true;
      Matter.World.remove(engine.world, ball.body);
      ballsRef.current = ballsRef.current.filter((b) => b !== ball);
      commitLanding(slot, now, ball.onLand);
    }

    function advancePlaybackBalls(ts: number) {
      const remaining: PlaybackBall[] = [];
      for (const pb of playbackBallsRef.current) {
        if (pb.landed) continue;
        const elapsed = ts - pb.startTs;
        const frameIdx = Math.floor(elapsed / FIXED_DT_MS);

        // Fire any peg-hit events whose recorded frame we've now passed.
        while (
          pb.nextPegHitIdx < pb.pegHits.length &&
          pb.pegHits[pb.nextPegHitIdx].frame <= frameIdx
        ) {
          const hit = pb.pegHits[pb.nextPegHitIdx];
          ringsRef.current.push({ x: hit.x, y: hit.y, t0: ts });
          if (ringsRef.current.length > 32) {
            ringsRef.current.splice(0, ringsRef.current.length - 32);
          }
          playPegHit();
          pb.nextPegHitIdx++;
        }

        // End of trajectory → land.
        if (frameIdx >= pb.trajectory.length - 1) {
          pb.landed = true;
          commitLanding(pb.targetSlot, ts, pb.onLand);
          continue;
        }
        remaining.push(pb);
      }
      playbackBallsRef.current = remaining;
    }

    function playbackBallPosition(pb: PlaybackBall, ts: number) {
      const elapsed = ts - pb.startTs;
      const f = elapsed / FIXED_DT_MS;
      const i = Math.min(pb.trajectory.length - 1, Math.max(0, Math.floor(f)));
      const j = Math.min(pb.trajectory.length - 1, i + 1);
      const t = f - i;
      const a = pb.trajectory[i];
      const b = pb.trajectory[j];
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t };
    }

    // ─── Render loop ────────────────────────────────────────────────────────
    const multipliers = MULTIPLIERS[rows];
    const slotWidth = gap;
    let prevTs = 0;

    function draw(ts: number) {
      if (!ctx) return;
      const dt = prevTs ? Math.min(ts - prevTs, 50) : 1000 / 60;
      prevTs = ts;
      Matter.Engine.update(engine, dt);
      advancePlaybackBalls(ts);

      // Background
      ctx.fillStyle = '#0e1b2a';
      ctx.fillRect(0, 0, BOARD_W, BOARD_H);

      // Subtle vertical rails for depth
      ctx.strokeStyle = 'rgba(34, 55, 79, 0.55)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        const gx = (BOARD_W / 8) * i;
        ctx.beginPath();
        ctx.moveTo(gx, 36);
        ctx.lineTo(gx, SLOT_Y - 8);
        ctx.stroke();
      }

      // Top + bottom guide strokes
      ctx.strokeStyle = 'rgba(142, 163, 187, 0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(36, 42);
      ctx.lineTo(604, 42);
      ctx.moveTo(36, 468);
      ctx.lineTo(604, 468);
      ctx.stroke();

      // Slot bins
      const activeSl = activeSlotRef.current;
      const hovSl = hoveredSlotRef.current;
      const bucketAnims = bucketAnimsRef.current;
      for (let i = 0; i <= rows; i++) {
        const sx = CENTER_X + (2 * i - rows) * (slotWidth / 2);
        const mult = multipliers[i];
        const color = multiplierColor(mult);

        // Bucket bounce offset: quadratic pop at impact, settles back.
        let yOffset = 0;
        const anim = bucketAnims.find((b) => b.slot === i);
        if (anim) {
          const u = Math.min(1, (ts - anim.t0) / BUCKET_BOUNCE_MS);
          // 0 → -1 → 0 smooth via sin
          yOffset = -BUCKET_BOUNCE_PX * Math.sin(Math.PI * u);
        }

        const isActive = activeSl === i;
        const isHov = hovSl === i;

        // Bucket body
        ctx.beginPath();
        ctx.rect(
          sx - slotWidth / 2 + 2,
          SLOT_Y + yOffset,
          slotWidth - 4,
          SLOT_H,
        );
        ctx.fillStyle = color;
        ctx.fill();

        // Subtle sheen so color isn't too flat
        const sheen = ctx.createLinearGradient(
          0,
          SLOT_Y + yOffset,
          0,
          SLOT_Y + yOffset + SLOT_H,
        );
        sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
        sheen.addColorStop(1, 'rgba(0,0,0,0.15)');
        ctx.fillStyle = sheen;
        ctx.fill();

        // Border + active/hover highlight
        ctx.strokeStyle = isActive
          ? '#ffffff'
          : isHov
          ? 'rgba(255,255,255,0.55)'
          : 'rgba(0,0,0,0.25)';
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.stroke();

        // Label
        const fontSize = rows === 16 ? 9 : rows === 12 ? 11 : 12;
        ctx.fillStyle = '#1a1a1a';
        ctx.font = `700 ${fontSize}px 'JetBrains Mono', ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${mult}x`, sx, SLOT_Y + yOffset + SLOT_H / 2);
      }

      // Pegs
      for (const peg of pegBodiesRef.current) {
        ctx.beginPath();
        ctx.arc(peg.position.x, peg.position.y, PEG_R, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }

      // Peg-hit expanding rings
      for (const ring of ringsRef.current) {
        const u = Math.min(1, (ts - ring.t0) / RING_DURATION_MS);
        const r = RING_R_FROM + (RING_R_TO - RING_R_FROM) * u;
        const alpha = 1 - u;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Balls — physics-driven (guided/pure mode)
      for (const ball of ballsRef.current) {
        const { x, y } = ball.body.position;
        drawBall(x, y);
      }
      // Balls — trajectory playback (production /degen)
      for (const pb of playbackBallsRef.current) {
        const { x, y } = playbackBallPosition(pb, ts);
        drawBall(x, y);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    function drawBall(x: number, y: number) {
      if (!ctx) return;
      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(255, 48, 48, 0.55)';
      ctx.beginPath();
      ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3030';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    }

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    onReady?.();

    return () => {
      cancelAnimationFrame(rafRef.current);
      Matter.Events.off(engine, 'beforeUpdate');
      Matter.Events.off(engine, 'collisionStart');
      Matter.Engine.clear(engine);
      engineRef.current = null;
      ballsRef.current = [];
      playbackBallsRef.current = [];
      ringsRef.current = [];
      bucketAnimsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // ─── Expose addBall ───────────────────────────────────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      addBall(path, onLand) {
        const engine = engineRef.current;
        if (!engine) return false;
        if (ballsRef.current.length >= MAX_PLINKO_BALLS) return false;

        const targetSlot = path.filter(Boolean).length;
        const jitter = (Math.random() - 0.5) * 8;
        const now = performance.now();
        const body = Matter.Bodies.circle(
          CENTER_X + jitter,
          TOP_Y - BALL_R * 2,
          BALL_R,
          {
            restitution: BALL_RESTITUTION,
            friction: 0.02,
            frictionAir: BALL_FRICTION_AIR,
            density: BALL_DENSITY,
            label: 'ball',
            collisionFilter: { category: CAT_BALL, mask: CAT_PEG | CAT_WALL },
          },
        );
        const initDir = path[0] ? 1 : -1;
        Matter.Body.setVelocity(body, { x: initDir * 0.8, y: 0.5 });

        Matter.World.add(engine.world, body);
        ballsRef.current.push({
          body,
          path,
          targetSlot,
          lastGuidedRow: -1,
          landed: false,
          spawnTs: now,
          lastMotionTs: now,
          onLand,
        });
        return true;
      },

      addPlaybackBall(trajectory, pegHits, targetSlot, onLand) {
        if (
          ballsRef.current.length + playbackBallsRef.current.length >=
          MAX_PLINKO_BALLS
        )
          return false;
        if (!trajectory || trajectory.length < 2) return false;
        playbackBallsRef.current.push({
          id: ++ballSeqRef.current,
          trajectory,
          pegHits: pegHits ?? [],
          nextPegHitIdx: 0,
          startTs: performance.now(),
          targetSlot,
          landed: false,
          onLand,
        });
        return true;
      },

      addPureBall(onLand) {
        const engine = engineRef.current;
        if (!engine) return false;
        if (ballsRef.current.length >= MAX_PLINKO_BALLS) return false;

        const jitter = (Math.random() - 0.5) * 12;
        const now = performance.now();
        // pylinko-faithful per-ball physics. Engine gravity / peg restitution
        // are unchanged so guided balls (used by /degen) still behave the
        // same. Bouncier ball + lower air drag = real bounces, no guidance.
        const body = Matter.Bodies.circle(
          CENTER_X + jitter,
          TOP_Y - BALL_R * 2,
          BALL_R,
          {
            restitution: 0.65,
            friction: 0.5,
            frictionAir: 0.004,
            density: BALL_DENSITY,
            label: 'ball',
            collisionFilter: { category: CAT_BALL, mask: CAT_PEG | CAT_WALL },
          },
        );
        // Sub-pixel horizontal jitter so successive drops don't trace the
        // exact same line. No path-keyed nudge.
        Matter.Body.setVelocity(body, {
          x: (Math.random() - 0.5) * 0.6,
          y: 0.4,
        });

        Matter.World.add(engine.world, body);
        ballsRef.current.push({
          body,
          path: null,
          targetSlot: -1,
          lastGuidedRow: -1,
          landed: false,
          spawnTs: now,
          lastMotionTs: now,
          onLand,
        });
        return true;
      },
    }),
    [],
  );

  // ─── Hover detection ──────────────────────────────────────────────────────
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
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={BOARD_W}
        height={BOARD_H}
        className="aspect-[640/520] w-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredSlot(null)}
      />

      <button
        type="button"
        aria-label={muted ? 'Unmute' : 'Mute'}
        onClick={handleMuteToggle}
        className="absolute left-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center border border-[var(--degen-panel-border,#22374f)] bg-[rgba(10,22,34,0.6)] font-mono text-[14px] text-[var(--degen-ink-dim,#8ea3bb)] hover:text-[var(--degen-accent,#ffd23f)]"
      >
        {muted ? '🔇' : '🔊'}
      </button>

      {/* Payout card stack — newest on top. Pure DOM so it survives rows resets. */}
      <ul
        aria-hidden
        className="pointer-events-none absolute right-2 top-2 flex flex-col gap-1"
      >
        {payoutCards.map((c, i) => (
          <li
            key={c.id}
            className="animate-[pn-card-in_280ms_ease-out] border border-[var(--degen-panel-border,#22374f)] px-2 py-1 font-mono text-[11px] font-semibold"
            style={{
              background: multiplierColor(c.multiplier),
              color: '#101010',
              opacity: 1 - i * 0.15,
            }}
          >
            {c.multiplier}x
          </li>
        ))}
      </ul>

      <div className="flex h-6 items-center justify-center font-mono text-[11px] text-[var(--degen-ink-dim,#8ea3bb)]">
        {hInfo ? (
          <span>
            Slot {hInfo.slot} · P: {(hInfo.prob * 100).toFixed(2)}% · Payout: {hInfo.mult}x
          </span>
        ) : (
          <span className="opacity-40">hover a bin to see odds</span>
        )}
      </div>

      <style jsx>{`
        @keyframes pn-card-in {
          from { opacity: 0; transform: translateY(-4px) scale(0.9); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
});

export default PlinkoBoard;
