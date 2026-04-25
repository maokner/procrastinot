'use client';

import { useEffect, useRef, useState } from 'react';
import PlinkoBoard, {
  MAX_PLINKO_BALLS,
  type PlinkoBoardHandle,
} from '@/components/plinko/PlinkoBoard';
import {
  PLINKO_ROWS,
  formatMultiplier,
  getMultipliers,
  multiplierColor,
  type PlinkoRows,
} from '@/lib/plinko';
import { simulatePlinko } from '@/lib/plinko-sim';

// Generate 32 random bytes for a client-side seed. Matches what the live
// server passes to simulatePlinko in production.
function randomSeed(): Uint8Array {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

type LandedDrop = {
  id: number;
  slot: number;
  multiplier: number;
  rows: PlinkoRows;
};

export default function DemoClient() {
  const boardRef = useRef<PlinkoBoardHandle>(null);
  const seqRef = useRef(0);
  const [rows, setRows] = useState<PlinkoRows>(12);
  const [boardReady, setBoardReady] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [lastSlot, setLastSlot] = useState<number | null>(null);
  const [history, setHistory] = useState<LandedDrop[]>([]);

  function spawnOne() {
    if (!boardReady) return;
    if (inFlight >= MAX_PLINKO_BALLS) return;

    const onLand = (slot: number) => {
      setInFlight((n) => Math.max(0, n - 1));
      setLastSlot(slot);
      setHistory((prev) =>
        [
          {
            id: ++seqRef.current,
            slot,
            rows,
            multiplier: getMultipliers(rows)[slot],
          },
          ...prev,
        ].slice(0, 20),
      );
    };

    const sim = simulatePlinko(randomSeed(), rows);
    const added = boardRef.current?.addPlaybackBall(
      sim.trajectory,
      sim.pegHits,
      sim.slot,
      onLand,
    );
    if (added) setInFlight((n) => n + 1);
  }

  function spawnFive() {
    let i = 0;
    const tick = () => {
      if (i >= 5) return;
      spawnOne();
      i++;
      setTimeout(tick, 140);
    };
    tick();
  }

  // Spacebar drop. Tap = one ball; hold = repeat at ~150ms cadence. Ignored
  // when focus is inside a text-entry control so typing seeds still works.
  const spaceHeldRef = useRef(false);
  const spaceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    function isTypingTarget(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      );
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (spaceHeldRef.current) return;
      spaceHeldRef.current = true;
      spawnOne();
      spaceTimerRef.current = setInterval(() => spawnOne(), 150);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      spaceHeldRef.current = false;
      if (spaceTimerRef.current) {
        clearInterval(spaceTimerRef.current);
        spaceTimerRef.current = null;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (spaceTimerRef.current) clearInterval(spaceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardReady, rows, inFlight]);

  const totalPaid = history.reduce((s, h) => s + h.multiplier, 0);
  const avg = history.length ? totalPaid / history.length : 0;

  return (
    <main className="pn-degen min-h-screen px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="pn-degen-marquee mb-6 flex flex-wrap items-end justify-between gap-4 pb-4">
          <div>
            <p className="pn-kicker mb-1">Demo</p>
            <h1 className="font-mono text-4xl font-bold tracking-tight">
              Plinko Playground
            </h1>
            <p className="mt-1 font-mono text-xs text-[var(--degen-ink-dim)]">
              Path generated client-side via Math.random(); ball animates
              along that path with guided physics. Live product picks the
              path server-side via HMAC-SHA256. Dev-only route (404 in prod).
            </p>
          </div>
          <div className="text-right font-mono text-xs text-[var(--degen-ink-dim)]">
            <p>Sampled avg multiplier</p>
            <p className="text-2xl font-semibold text-[var(--degen-accent)]">
              {avg ? `${avg.toFixed(3)}x` : '—'}
            </p>
            <p>{history.length} drops</p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="pn-degen-board-frame">
            <PlinkoBoard
              ref={boardRef}
              rows={rows}
              activeSlot={lastSlot}
              onReady={() => setBoardReady(true)}
            />
          </section>

          <aside className="flex flex-col gap-5">
            <div>
              <p className="pn-kicker mb-2">Rows</p>
              <div className="grid grid-cols-3 gap-2">
                {PLINKO_ROWS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className="pn-degen-pill"
                    data-active={rows === opt}
                    disabled={inFlight > 0}
                    onClick={() => {
                      setBoardReady(false);
                      setRows(opt);
                      setHistory([]);
                      setLastSlot(null);
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="pn-degen-btn pn-degen-btn-primary w-full"
                onClick={spawnOne}
                disabled={!boardReady || inFlight >= MAX_PLINKO_BALLS}
              >
                Drop  ·  <span className="opacity-70">Space</span>
              </button>
              <button
                type="button"
                className="pn-degen-btn pn-degen-btn-accent w-full"
                onClick={spawnFive}
                disabled={!boardReady}
              >
                Drop 5
              </button>
              <p className="font-mono text-[11px] text-[var(--degen-ink-dim)]">
                {inFlight} / {MAX_PLINKO_BALLS} in flight
              </p>
            </div>

            <div className="pn-degen-card p-3">
              <p className="pn-kicker mb-2">Recent landings</p>
              {history.length === 0 ? (
                <p className="font-mono text-xs text-[var(--degen-ink-dim)]">
                  Drop a ball.
                </p>
              ) : (
                <ul className="flex flex-col gap-1 font-mono text-xs">
                  {history.slice(0, 12).map((h) => (
                    <li key={h.id} className="flex justify-between">
                      <span className="text-[var(--degen-ink-dim)]">
                        slot {h.slot}
                      </span>
                      <span style={{ color: multiplierColor(h.multiplier) }}>
                        {formatMultiplier(h.multiplier)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="font-mono text-[11px] leading-relaxed text-[var(--degen-ink-dim)]">
              Paths are generated client-side with Math.random(). The real
              product selects paths server-side via HMAC-SHA256 for
              provably-fair outcomes; see{' '}
              <code>web/app/api/plinko/drop/route.ts</code>.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
