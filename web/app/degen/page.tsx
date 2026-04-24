'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase';
import type { DegenBalance, PlinkoDrop } from '@/lib/db-types';
import {
  MAX_BET_USDC,
  MIN_BET_USDC,
  MULTIPLIERS,
  PLINKO_ROWS,
  type PlinkoRows,
  multiplierColor,
  unitsToUsdc,
} from '@/lib/plinko';

type BallPosition = { x: number; y: number; visible: boolean };
type DropResult = {
  dropId: string;
  path: boolean[];
  slot: number;
  multiplier: number;
  payout: string;
  balanceBefore: string;
  balanceAfter: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
};

const BOARD_W = 640;
const BOARD_H = 520;
const CENTER_X = BOARD_W / 2;
const TOP_Y = 56;
const BOTTOM_Y = 448;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

export default function DegenPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [balance, setBalance] = useState<DegenBalance | null>(null);
  const [drops, setDrops] = useState<PlinkoDrop[]>([]);
  const [rows, setRows] = useState<PlinkoRows>(12);
  const [ballValue, setBallValue] = useState('0.10');
  const [clientSeed, setClientSeed] = useState('procrastinot');
  const [ball, setBall] = useState<BallPosition>({ x: CENTER_X, y: TOP_Y, visible: false });
  const [dropping, setDropping] = useState(false);
  const [cashoutPending, setCashoutPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<DropResult | null>(null);

  // Guards to suppress realtime updates during animation
  const droppingRef = useRef(false);
  const pendingDropsRef = useRef<PlinkoDrop[]>([]);

  useEffect(() => {
    const sb = supabaseBrowser();
    let active = true;

    async function load() {
      const { data: userResp } = await sb.auth.getUser();
      const id = userResp.user?.id ?? null;
      if (!active) return;
      setUserId(id);
      if (!id) return;

      const [{ data: balanceRow }, { data: dropRows }] = await Promise.all([
        sb.from('degen_balances').select('*').eq('user_id', id).maybeSingle(),
        sb
          .from('plinko_drops')
          .select('*')
          .eq('user_id', id)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);
      if (!active) return;
      setBalance((balanceRow as DegenBalance | null) ?? null);
      setDrops((dropRows as PlinkoDrop[] | null) ?? []);
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`degen-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'degen_balances',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          // Suppress during drop — balance is set from API response after animation
          if (!droppingRef.current) {
            setBalance(payload.new as DegenBalance);
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'plinko_drops',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const next = payload.new as PlinkoDrop;
          if (droppingRef.current) {
            // Queue until animation completes
            pendingDropsRef.current = [next, ...pendingDropsRef.current];
          } else {
            setDrops((prev) => [next, ...prev.filter((d) => d.id !== next.id)].slice(0, 20));
          }
        },
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [userId]);

  const balanceUnits = balance?.balance_usdc ?? 0;
  const balanceText = unitsToUsdc(balanceUnits);
  const maxBet = Math.max(MIN_BET_USDC, Math.min(MAX_BET_USDC, balanceUnits / 1_000_000));
  const multipliers = MULTIPLIERS[rows];

  const boardGeometry = useMemo(() => {
    const gap = 560 / rows;
    const rowGap = (BOTTOM_Y - TOP_Y - 40) / rows;
    const pegs: { id: string; x: number; y: number }[] = [];
    for (let row = 1; row <= rows; row += 1) {
      for (let col = 0; col <= row; col += 1) {
        pegs.push({
          id: `${row}-${col}`,
          x: CENTER_X + (2 * col - row) * (gap / 2),
          y: TOP_Y + row * rowGap,
        });
      }
    }
    const slots = multipliers.map((multiplier, slot) => ({
      slot,
      multiplier,
      x: CENTER_X + (2 * slot - rows) * (gap / 2),
    }));
    return { gap, rowGap, pegs, slots };
  }, [multipliers, rows]);

  async function animatePath(path: boolean[]) {
    setBall({ x: CENTER_X, y: TOP_Y, visible: true });
    await delay(180);

    let rights = 0;
    for (let i = 0; i < path.length; i += 1) {
      const goRight = path[i];
      if (goRight) rights += 1;

      const destX = CENTER_X + (2 * rights - (i + 1)) * (boardGeometry.gap / 2);
      const destY = TOP_Y + (i + 1) * boardGeometry.rowGap;
      // Gravity: starts ~95ms per row, accelerates to ~45ms at bottom
      const stepMs = Math.max(45, 95 - i * 3);

      // Phase 1: ball approaches peg (slightly above)
      setBall({ x: destX, y: destY - 4, visible: true });
      await delay(Math.round(stepMs * 0.55));
      // Phase 2: settle with slight downward overshoot (peg bounce feel)
      setBall({ x: destX, y: destY + 3, visible: true });
      await delay(Math.round(stepMs * 0.45));
    }

    await delay(60);
    setBall({
      x: CENTER_X + (2 * rights - path.length) * (boardGeometry.gap / 2),
      y: BOTTOM_Y,
      visible: true,
    });
    await delay(280);
    setBall((current) => ({ ...current, visible: false }));
  }

  async function handleDrop() {
    droppingRef.current = true;
    setDropping(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/plinko/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, ballValue, clientSeed }),
      });
      const data = (await res.json()) as DropResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Drop failed');

      // Animate FIRST — balance and drops update only after ball lands
      await animatePath(data.path);

      setLastResult(data);
      setBalance((prev) =>
        prev ? { ...prev, balance_usdc: Math.round(Number(data.balanceAfter) * 1_000_000) } : prev,
      );

      // Flush drops that arrived during animation
      const queued = pendingDropsRef.current;
      if (queued.length > 0) {
        pendingDropsRef.current = [];
        setDrops((prev) => {
          const merged = [...queued, ...prev];
          return merged.filter((d, i, a) => a.findIndex((x) => x.id === d.id) === i).slice(0, 20);
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Drop failed');
    } finally {
      droppingRef.current = false;
      setDropping(false);
    }
  }

  async function handleCashout() {
    setCashoutPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/plinko/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { error?: string; txHash?: string };
      if (!res.ok) throw new Error(data.error ?? 'Cashout failed');
      setMessage(data.txHash ? `Withdrawn. Tx ${data.txHash}` : 'Withdrawn. Check your wallet.');
      // Immediately reflect zero balance — don't wait for realtime
      setBalance((prev) => (prev ? { ...prev, balance_usdc: 0 } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cashout failed');
    } finally {
      setCashoutPending(false);
    }
  }

  return (
    <main className="pn-page max-w-7xl">
      <Link href="/my" className="pn-backlink mb-5">Back to commitments</Link>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b-4 border-black pb-5">
            <div>
              <p className="pn-kicker mb-2">Degen Mode</p>
              <h1 className="pn-title text-5xl sm:text-6xl">Plinko</h1>
            </div>
            <div className="text-right">
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-2)]">Playing balance</p>
              <p className="font-mono text-3xl font-semibold">{balanceText}</p>
              <p className="font-mono text-xs text-[var(--ink-2)]">USDC</p>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="border border-black bg-[var(--bg-0)] p-3">
              <PlinkoBoard
                rows={rows}
                ball={ball}
                pegs={boardGeometry.pegs}
                slots={boardGeometry.slots}
                activeSlot={lastResult?.slot ?? null}
              />
            </div>

            <aside className="flex flex-col gap-5 border-t-4 border-black pt-5 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
              <div>
                <p className="mb-2 font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-2)]">Rows</p>
                <div className="grid grid-cols-3 gap-2">
                  {PLINKO_ROWS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setRows(option)}
                      disabled={dropping}
                      className={`pn-btn px-2 py-2 text-xs ${rows === option ? 'pn-btn-primary' : 'pn-btn-secondary'}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex flex-col gap-2">
                <span className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-2)]">Ball value</span>
                <input
                  value={ballValue}
                  onChange={(event) => setBallValue(event.target.value)}
                  inputMode="decimal"
                  className="pn-input font-mono text-xl"
                />
                <input
                  type="range"
                  min={MIN_BET_USDC}
                  max={maxBet}
                  step="0.10"
                  value={Math.min(Number(ballValue) || MIN_BET_USDC, maxBet)}
                  onChange={(event) => setBallValue(Number(event.target.value).toFixed(2))}
                  disabled={balanceUnits <= 0 || dropping}
                  className="w-full accent-black"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-2)]">Client seed</span>
                <input
                  value={clientSeed}
                  onChange={(event) => setClientSeed(event.target.value)}
                  maxLength={128}
                  className="pn-input font-mono text-sm"
                />
              </label>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void handleDrop()}
                  disabled={!userId || balanceUnits <= 0 || dropping || cashoutPending}
                  className="pn-btn pn-btn-primary w-full"
                >
                  {dropping ? 'Dropping...' : 'Drop'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCashout()}
                  disabled={!userId || balanceUnits <= 0 || dropping || cashoutPending}
                  className="pn-btn pn-btn-secondary w-full"
                >
                  {cashoutPending ? 'Cashing out...' : 'Cash Out'}
                </button>
              </div>

              {lastResult && (
                <div className="border-t border-[var(--line)] pt-4 text-sm">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-2)]">Last drop</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs">
                    <span>Slot</span><span className="text-right">{lastResult.slot}</span>
                    <span>Multiplier</span><span className="text-right">{lastResult.multiplier.toFixed(4)}x</span>
                    <span>Payout</span><span className="text-right">{lastResult.payout}</span>
                    <span>Seed hash</span><span className="truncate text-right">{compactHash(lastResult.serverSeedHash)}</span>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </section>

        <section className="border-t-4 border-black pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
          <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-2)]">Recent drops</h2>
          {drops.length === 0 ? (
            <p className="text-sm text-[var(--ink-2)]">No drops yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--line)]">
              {drops.map((drop) => {
                const net = drop.payout_usdc - drop.ball_value_usdc;
                return (
                  <li key={drop.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-mono text-xs">
                        {unitsToUsdc(drop.ball_value_usdc)} to {unitsToUsdc(drop.payout_usdc)} USDC
                      </p>
                      <p className="truncate font-mono text-[10px] text-[var(--ink-2)]">
                        {compactHash(drop.server_seed_hash)}
                      </p>
                    </div>
                    <div className="text-right font-mono text-xs">
                      <p style={{ color: multiplierColor(Number(drop.multiplier)) }}>
                        {Number(drop.multiplier).toFixed(2)}x
                      </p>
                      <p className={net >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
                        {net >= 0 ? '+' : ''}{unitsToUsdc(net)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {(message || error) && (
            <p className={`mt-5 border p-3 text-sm ${error ? 'border-[var(--danger)] text-[var(--danger)]' : 'border-black text-[var(--ink-0)]'}`}>
              {error ?? message}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function PlinkoBoard({
  rows,
  ball,
  pegs,
  slots,
  activeSlot,
}: {
  rows: PlinkoRows;
  ball: BallPosition;
  pegs: { id: string; x: number; y: number }[];
  slots: { slot: number; multiplier: number; x: number }[];
  activeSlot: number | null;
}) {
  const slotWidth = 560 / rows;
  return (
    <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} role="img" aria-label="Plinko board" className="aspect-[640/520] w-full">
      <rect x="0" y="0" width={BOARD_W} height={BOARD_H} fill="var(--bg-0)" />
      <path d="M40 42H600M40 470H600" stroke="black" strokeWidth="3" />
      {pegs.map((peg) => (
        <circle key={peg.id} cx={peg.x} cy={peg.y} r="5" fill="black" opacity="0.82" />
      ))}
      {slots.map(({ slot, multiplier, x }) => (
        <g key={slot}>
          <rect
            x={x - slotWidth / 2 + 2}
            y="474"
            width={slotWidth - 4}
            height="34"
            fill={activeSlot === slot ? 'black' : 'transparent'}
            stroke="black"
            strokeWidth="1"
          />
          <text
            x={x}
            y="496"
            textAnchor="middle"
            fontFamily="monospace"
            fontSize={rows === 16 ? 10 : 12}
            fill={activeSlot === slot ? 'var(--bg-0)' : multiplierColor(multiplier)}
          >
            {multiplier}x
          </text>
        </g>
      ))}
      {ball.visible && (
        <circle
          cx={ball.x}
          cy={ball.y}
          r="11"
          fill="var(--accent)"
          stroke="black"
          strokeWidth="3"
          style={{ transition: 'cx 40ms ease-out, cy 40ms ease-out' }}
        />
      )}
    </svg>
  );
}
