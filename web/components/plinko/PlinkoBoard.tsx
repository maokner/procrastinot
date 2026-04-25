'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import Matter from 'matter-js';
import {
  DEFAULT_RISK,
  binProbability,
  formatMultiplier,
  getMultipliers,
  multiplierColor,
  type PlinkoRows,
  type RiskLevel,
} from '@/lib/plinko';
import {
  BALL_DENSITY,
  BALL_FRICTION_AIR,
  BALL_RESTITUTION,
  CAT_BALL,
  CAT_PEG,
  CAT_WALL,
  GRAVITY_Y,
  GUIDE_MIN_SPEED,
  MAX_BALL_LIFETIME_MS,
  PEG_RESTITUTION,
  STUCK_MIN_SPEED_SQ,
  STUCK_TIMEOUT_MS,
  TARGET_ATTRACTION,
  bucketCenterX,
  getBoardGeometry,
  pegLayout,
} from '@/lib/plinko-physics';
import {
  isMuted,
  playBucketLand,
  playPegHit,
  toggleMuted,
} from '@/lib/plinko-sounds';

export const MAX_PLINKO_BALLS = 24;
const MAX_PAYOUT_CARDS = 5;

const RING_DURATION_MS = 250;
const BUCKET_BOUNCE_MS = 280;
const BUCKET_BOUNCE_PX = 4;

// ─── Types ──────────────────────────────────────────────────────────────────
// Path-driven ball: the math engine has already chosen the bucket. `path` is
// the bit array from the server; `targetSlot = path.filter(Boolean).length`.
// The renderer animates a guided ball that lands in this exact bucket.
type BallRecord = {
  body: Matter.Body;
  path: boolean[];
  targetSlot: number;
  lastGuidedRow: number;
  landed: boolean;
  spawnTs: number;
  lastMotionTs: number;
  onLand: (slot: number) => void;
};

type Ring = { x: number; y: number; t0: number };
type BucketAnim = { slot: number; t0: number };

export type PlinkoBoardHandle = {
  addBall: (path: boolean[], onLand: (slot: number) => void) => boolean;
};

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
    riskLevel?: RiskLevel;
    activeSlot: number | null;
    onReady?: () => void;
  }
>(function PlinkoBoard(
  { rows, riskLevel = DEFAULT_RISK, activeSlot, onReady },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const pegBodiesRef = useRef<Matter.Body[]>([]);
  const ballsRef = useRef<BallRecord[]>([]);
  const ringsRef = useRef<Ring[]>([]);
  const bucketAnimsRef = useRef<BucketAnim[]>([]);
  const rafRef = useRef<number>(0);
  const activeSlotRef = useRef(activeSlot);
  const hoveredSlotRef = useRef<number | null>(null);
  const cardSeqRef = useRef(0);

  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [payoutCards, setPayoutCards] = useState<PayoutCard[]>([]);
  const [muted, setMutedState] = useState(false);

  const geo = useMemo(() => getBoardGeometry(rows), [rows]);
  const multipliers = useMemo(
    () => getMultipliers(rows, riskLevel),
    [rows, riskLevel],
  );

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
    ringsRef.current = [];
    bucketAnimsRef.current = [];

    const engine = Matter.Engine.create({ gravity: { x: 0, y: GRAVITY_Y } });
    engineRef.current = engine;

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
    pegBodiesRef.current = pegBodies;

    const wallOpts = {
      isStatic: true,
      restitution: 0.2,
      friction: 0.1,
      label: 'wall',
      collisionFilter: { category: CAT_WALL, mask: CAT_BALL },
    };
    const wallInset = 18;
    const walls: Matter.Body[] = [
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
      // Floor sits below the bucket so balls visibly settle in their slot.
      Matter.Bodies.rectangle(
        geo.boardW / 2,
        geo.slotY + geo.slotH + 22,
        geo.boardW,
        44,
        wallOpts,
      ),
    ];

    // Bucket dividers — one between every adjacent pair of buckets, plus the
    // outer two edges. These confine the ball to the predetermined slot once
    // it has dropped past the last peg row.
    const dividerTop = geo.slotY - 4;
    const dividerBottom = geo.slotY + geo.slotH;
    for (let k = 0; k <= rows + 1; k++) {
      const xDiv =
        geo.centerX - (rows * geo.gap) / 2 + (k - 0.5) * geo.gap;
      walls.push(
        Matter.Bodies.rectangle(
          xDiv,
          (dividerTop + dividerBottom) / 2,
          3,
          dividerBottom - dividerTop,
          wallOpts,
        ),
      );
    }

    Matter.World.add(engine.world, [...pegBodies, ...walls]);

    // Peg-hit ring + click sound.
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
          if (ringsRef.current.length > 32) {
            ringsRef.current.splice(0, ringsRef.current.length - 32);
          }
          playPegHit();
        }
      }
    });

    // Per-ball guidance: nudge velocity by row, attract toward target near
    // the bottom, then land when the ball reaches bucket bottom.
    Matter.Events.on(engine, 'beforeUpdate', () => {
      const now = performance.now();

      for (const ball of ballsRef.current) {
        if (ball.landed) continue;
        const { x, y } = ball.body.position;
        const vx = ball.body.velocity.x;
        const vy = ball.body.velocity.y;
        const speedSq = vx * vx + vy * vy;
        if (speedSq > STUCK_MIN_SPEED_SQ) ball.lastMotionTs = now;

        // Land when ball is well inside the bucket — visually it falls all
        // the way down rather than vanishing above the bucket lip.
        if (y >= geo.slotY + geo.slotH - geo.ballR - 2) {
          landBall(ball, ball.targetSlot, now);
          continue;
        }

        // Stuck-ball cleanup. The attractor can occasionally pin a ball
        // against a peg corner; this catches that case.
        if (
          now - ball.lastMotionTs > STUCK_TIMEOUT_MS ||
          now - ball.spawnTs > MAX_BALL_LIFETIME_MS
        ) {
          landBall(ball, ball.targetSlot, now);
          continue;
        }

        // Per-row velocity nudge — picks the side dictated by the bit array.
        const gapIndex = Math.floor((y - geo.topY) / geo.rowGap);
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

        // Soft attractor so the visual landing aligns with the target slot.
        if (y > geo.slotY - geo.rowGap * 3) {
          const targetX = bucketCenterX(ball.targetSlot, rows, geo);
          Matter.Body.applyForce(ball.body, ball.body.position, {
            x: (targetX - x) * TARGET_ATTRACTION * ball.body.mass,
            y: 0,
          });
        }
      }

      // Trim ring + bucket animations.
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

      ballsRef.current = ballsRef.current.filter((b) => {
        if (b.body.position.y > geo.boardH + 80) {
          Matter.World.remove(engine.world, b.body);
          return false;
        }
        return true;
      });
    });

    function commitLanding(slot: number, now: number, onLand: (s: number) => void) {
      bucketAnimsRef.current.push({ slot, t0: now });
      const mult = multipliers[slot];
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

    // ─── Render loop ────────────────────────────────────────────────────────
    const slotWidth = geo.gap;
    let prevTs = 0;

    function draw(ts: number) {
      if (!ctx) return;
      const dt = prevTs ? Math.min(ts - prevTs, 50) : 1000 / 60;
      prevTs = ts;
      Matter.Engine.update(engine, dt);

      // Background
      ctx.fillStyle = '#0e1b2a';
      ctx.fillRect(0, 0, geo.boardW, geo.boardH);

      // Faint vertical rails for depth
      ctx.strokeStyle = 'rgba(34, 55, 79, 0.55)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        const gx = (geo.boardW / 8) * i;
        ctx.beginPath();
        ctx.moveTo(gx, 36);
        ctx.lineTo(gx, geo.slotY - 8);
        ctx.stroke();
      }

      // Slot bins
      const activeSl = activeSlotRef.current;
      const hovSl = hoveredSlotRef.current;
      const bucketAnims = bucketAnimsRef.current;
      for (let i = 0; i <= rows; i++) {
        const sx = bucketCenterX(i, rows, geo);
        const mult = multipliers[i];
        const color = multiplierColor(mult);

        let yOffset = 0;
        const anim = bucketAnims.find((b) => b.slot === i);
        if (anim) {
          const u = Math.min(1, (ts - anim.t0) / BUCKET_BOUNCE_MS);
          yOffset = -BUCKET_BOUNCE_PX * Math.sin(Math.PI * u);
        }

        const isActive = activeSl === i;
        const isHov = hovSl === i;

        ctx.beginPath();
        ctx.rect(
          sx - slotWidth / 2 + 2,
          geo.slotY + yOffset,
          slotWidth - 4,
          geo.slotH,
        );
        ctx.fillStyle = color;
        ctx.fill();

        const sheen = ctx.createLinearGradient(
          0,
          geo.slotY + yOffset,
          0,
          geo.slotY + yOffset + geo.slotH,
        );
        sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
        sheen.addColorStop(1, 'rgba(0,0,0,0.15)');
        ctx.fillStyle = sheen;
        ctx.fill();

        ctx.strokeStyle = isActive
          ? '#ffffff'
          : isHov
            ? 'rgba(255,255,255,0.55)'
            : 'rgba(0,0,0,0.25)';
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.stroke();

        const fontSize = rows === 16 ? 9 : rows === 12 ? 11 : 12;
        ctx.fillStyle = '#1a1a1a';
        ctx.font = `700 ${fontSize}px 'JetBrains Mono', ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatMultiplier(mult), sx, geo.slotY + yOffset + geo.slotH / 2);
      }

      // Pegs
      for (const peg of pegBodiesRef.current) {
        ctx.beginPath();
        ctx.arc(peg.position.x, peg.position.y, geo.pegR, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }

      // Peg-hit rings
      for (const ring of ringsRef.current) {
        const u = Math.min(1, (ts - ring.t0) / RING_DURATION_MS);
        const r = geo.pegR + (18 - geo.pegR) * u;
        const alpha = 1 - u;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Balls
      for (const ball of ballsRef.current) {
        const { x, y } = ball.body.position;
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
      ctx.arc(x, y, geo.ballR, 0, Math.PI * 2);
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
      ringsRef.current = [];
      bucketAnimsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, geo]);

  // ─── Expose addBall ────────────────────────────────────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      addBall(path, onLand) {
        const engine = engineRef.current;
        if (!engine) return false;
        if (ballsRef.current.length >= MAX_PLINKO_BALLS) return false;
        if (path.length !== rows) return false;

        const targetSlot = path.filter(Boolean).length;
        const jitter = (Math.random() - 0.5) * 8;
        const now = performance.now();
        const body = Matter.Bodies.circle(
          geo.centerX + jitter,
          geo.topY - geo.ballR * 2,
          geo.ballR,
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
        Matter.Body.setVelocity(body, { x: initDir * 1.0, y: 0.6 });

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
    }),
    [rows, geo],
  );

  // ─── Hover detection ──────────────────────────────────────────────────────
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (geo.boardW / rect.width);
    const my = (e.clientY - rect.top) * (geo.boardH / rect.height);

    if (my >= geo.slotY && my <= geo.slotY + geo.slotH) {
      const leftEdge = geo.centerX - (rows * geo.gap) / 2;
      const idx = Math.round((mx - leftEdge) / geo.gap);
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
          mult: multipliers[hoveredSlot],
        }
      : null;

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={geo.boardW}
        height={geo.boardH}
        style={{ aspectRatio: `${geo.boardW} / ${geo.boardH}` }}
        className="w-full"
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
            {formatMultiplier(c.multiplier)}
          </li>
        ))}
      </ul>

      <div className="flex h-6 items-center justify-center font-mono text-[11px] text-[var(--degen-ink-dim,#8ea3bb)]">
        {hInfo ? (
          <span>
            Slot {hInfo.slot} · P: {(hInfo.prob * 100).toFixed(2)}% · Payout: {formatMultiplier(hInfo.mult)}
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
