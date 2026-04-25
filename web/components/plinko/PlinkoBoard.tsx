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
const FRAME_DT_MS = 1000 / 60;

const RING_DURATION_MS = 250;
const BUCKET_BOUNCE_MS = 280;
const BUCKET_BOUNCE_PX = 4;

// Trajectory replay: server runs the physics, returns the ball's position
// per fixed step plus peg-hit timestamps. We animate by interpolating along
// the recorded trajectory and firing peg-hit effects on the matching frame.
type PlaybackBall = {
  id: number;
  trajectory: number[][]; // [[x, y], ...] one entry per FRAME_DT_MS
  pegHits: { frame: number; x: number; y: number }[];
  nextPegHitIdx: number;
  startTs: number;
  targetSlot: number;
  landed: boolean;
  onLand: (slot: number) => void;
};

type Ring = { x: number; y: number; t0: number };
type BucketAnim = { slot: number; t0: number };

export type PlinkoBoardHandle = {
  addPlaybackBall: (
    trajectory: number[][],
    pegHits: { frame: number; x: number; y: number }[],
    targetSlot: number,
    onLand: (slot: number) => void,
  ) => boolean;
};

type PayoutCard = {
  id: number;
  slot: number;
  multiplier: number;
};

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

  const geo = useMemo(() => getBoardGeometry(rows), [rows]);
  const pegs = useMemo(() => pegLayout(rows, geo), [rows, geo]);
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

  // Render loop — pure canvas, no physics engine on the client. The server's
  // recorded trajectories drive every ball.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    playbackBallsRef.current = [];
    ringsRef.current = [];
    bucketAnimsRef.current = [];

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

    function advancePlaybackBalls(ts: number) {
      const remaining: PlaybackBall[] = [];
      for (const pb of playbackBallsRef.current) {
        if (pb.landed) continue;
        const elapsed = ts - pb.startTs;
        const frameIdx = Math.floor(elapsed / FRAME_DT_MS);

        // Fire peg-hit effects whose recorded frame we've now passed.
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

        if (frameIdx >= pb.trajectory.length - 1) {
          pb.landed = true;
          commitLanding(pb.targetSlot, ts, pb.onLand);
          continue;
        }
        remaining.push(pb);
      }
      playbackBallsRef.current = remaining;
    }

    function ballPosition(pb: PlaybackBall, ts: number) {
      const elapsed = ts - pb.startTs;
      const f = elapsed / FRAME_DT_MS;
      const i = Math.min(pb.trajectory.length - 1, Math.max(0, Math.floor(f)));
      const j = Math.min(pb.trajectory.length - 1, i + 1);
      const t = f - i;
      const a = pb.trajectory[i];
      const b = pb.trajectory[j];
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t };
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

    function draw(ts: number) {
      if (!ctx) return;
      advancePlaybackBalls(ts);

      // Background
      ctx.fillStyle = '#0e1b2a';
      ctx.fillRect(0, 0, geo.boardW, geo.boardH);

      // Faint vertical rails
      ctx.strokeStyle = 'rgba(34, 55, 79, 0.55)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        const gx = (geo.boardW / 8) * i;
        ctx.beginPath();
        ctx.moveTo(gx, 36);
        ctx.lineTo(gx, geo.bucketY - geo.bucketH / 2 - 8);
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
        const slotW = geo.pegGap;
        const slotTop = geo.bucketY - geo.bucketH / 2;

        ctx.beginPath();
        ctx.rect(
          sx - slotW / 2 + 2,
          slotTop + yOffset,
          slotW - 4,
          geo.bucketH,
        );
        ctx.fillStyle = color;
        ctx.fill();

        const sheen = ctx.createLinearGradient(
          0,
          slotTop + yOffset,
          0,
          slotTop + yOffset + geo.bucketH,
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
        ctx.fillText(
          formatMultiplier(mult),
          sx,
          slotTop + yOffset + geo.bucketH / 2,
        );
      }

      // Pegs
      for (const peg of pegs) {
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, geo.pegR, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }

      // Peg-hit rings
      const ringCut = ts - RING_DURATION_MS;
      ringsRef.current = ringsRef.current.filter((r) => r.t0 >= ringCut);
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

      // Bucket-bounce GC
      const bucketCut = ts - BUCKET_BOUNCE_MS;
      if (
        bucketAnimsRef.current.length &&
        bucketAnimsRef.current[0].t0 < bucketCut
      ) {
        bucketAnimsRef.current = bucketAnimsRef.current.filter(
          (b) => b.t0 >= bucketCut,
        );
      }

      // Balls
      for (const pb of playbackBallsRef.current) {
        const { x, y } = ballPosition(pb, ts);
        drawBall(x, y);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    onReady?.();

    return () => {
      cancelAnimationFrame(rafRef.current);
      playbackBallsRef.current = [];
      ringsRef.current = [];
      bucketAnimsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, geo, pegs, multipliers]);

  useImperativeHandle(
    ref,
    () => ({
      addPlaybackBall(trajectory, pegHits, targetSlot, onLand) {
        if (playbackBallsRef.current.length >= MAX_PLINKO_BALLS) return false;
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
    }),
    [],
  );

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (geo.boardW / rect.width);
    const my = (e.clientY - rect.top) * (geo.boardH / rect.height);

    if (
      my >= geo.bucketY - geo.bucketH / 2 &&
      my <= geo.bucketY + geo.bucketH / 2
    ) {
      const leftEdge = geo.centerX - (rows * geo.pegGap) / 2;
      const idx = Math.round((mx - leftEdge) / geo.pegGap);
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
            Slot {hInfo.slot} · P: {(hInfo.prob * 100).toFixed(2)}% · Payout:{' '}
            {formatMultiplier(hInfo.mult)}
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
