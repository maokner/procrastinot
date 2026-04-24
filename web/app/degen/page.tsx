'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase';
import type { DegenBalance, PlinkoDrop } from '@/lib/db-types';
import {
  MAX_BET_USDC,
  MIN_BET_USDC,
  PLINKO_ROWS,
  type PlinkoRows,
  unitsToUsdc,
  multiplierColor,
  parseUsdcToUnits,
} from '@/lib/plinko';
import PlinkoBoard, {
  MAX_PLINKO_BALLS,
  type PlinkoBoardHandle,
} from '@/components/plinko/PlinkoBoard';

const SPAWN_DELAY_MS = 700;

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
  const [ballsInFlight, setBallsInFlight] = useState(0);
  const [cashoutPending, setCashoutPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<DropResult | null>(null);
  const [boardReady, setBoardReady] = useState(false);

  const boardRef = useRef<PlinkoBoardHandle>(null);
  // Suppresses realtime balance updates while any ball is in flight
  const droppingRef = useRef(false);
  const pendingDropsRef = useRef<PlinkoDrop[]>([]);
  const ballsInFlightRef = useRef(0);
  const reservedUnitsRef = useRef(0);
  const balanceUnitsRef = useRef(0);
  const currentBetUnitsRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Initial load ──────────────────────────────────────────────────────────
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
      const nextBalance = (balanceRow as DegenBalance | null) ?? null;
      balanceUnitsRef.current = nextBalance?.balance_usdc ?? 0;
      setBalance(nextBalance);
      setDrops((dropRows as PlinkoDrop[] | null) ?? []);
    }

    void load();
    return () => { active = false; };
  }, []);

  // ── Realtime subscriptions ─────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`degen-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'degen_balances', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (!droppingRef.current) {
            const nextBalance = payload.new as DegenBalance;
            balanceUnitsRef.current = nextBalance.balance_usdc;
            setBalance(nextBalance);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'plinko_drops', filter: `user_id=eq.${userId}` },
        (payload) => {
          const next = payload.new as PlinkoDrop;
          if (droppingRef.current) {
            pendingDropsRef.current = [next, ...pendingDropsRef.current];
          } else {
            setDrops((prev) => [next, ...prev.filter((d) => d.id !== next.id)].slice(0, 20));
          }
        },
      )
      .subscribe();

    return () => { void sb.removeChannel(channel); };
  }, [userId]);

  const balanceUnits = balance?.balance_usdc ?? 0;
  const availableBalanceUnits = Math.max(0, balanceUnits - reservedUnitsRef.current);
  const balanceText = unitsToUsdc(balanceUnits);
  const currentBetUnits = useMemo(() => {
    const parsed = parseUsdcToUnits(ballValue);
    if (parsed === null) return null;
    return Number(parsed);
  }, [ballValue]);
  useEffect(() => {
    balanceUnitsRef.current = balanceUnits;
  }, [balanceUnits]);
  useEffect(() => {
    currentBetUnitsRef.current = currentBetUnits;
  }, [currentBetUnits]);
  const maxBet = Math.max(
    MIN_BET_USDC,
    Math.min(MAX_BET_USDC, availableBalanceUnits / 1_000_000),
  );

  // ── Drop handler ───────────────────────────────────────────────────────
  async function handleDrop() {
    const liveBetUnits = currentBetUnitsRef.current;
    const liveAvailableUnits = Math.max(0, balanceUnitsRef.current - reservedUnitsRef.current);
    if (
      liveBetUnits === null ||
      liveBetUnits > liveAvailableUnits ||
      ballsInFlightRef.current >= MAX_PLINKO_BALLS
    ) {
      return;
    }

    setError(null);
    setMessage(null);
    reservedUnitsRef.current += liveBetUnits;
    ballsInFlightRef.current++;
    droppingRef.current = true;
    setBallsInFlight(ballsInFlightRef.current);

    const releaseReservation = () => {
      reservedUnitsRef.current = Math.max(0, reservedUnitsRef.current - liveBetUnits);
    };

    try {
      const res = await fetch('/api/plinko/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, ballValue, clientSeed }),
      });
      const data = (await res.json()) as DropResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Drop failed');

      const added = boardRef.current?.addBall(data.path, (slot) => {
        // Ball has physically landed — update balance and result
        setLastResult({ ...data, slot });
        releaseReservation();
        setBalance((prev) =>
          prev
            ? { ...prev, balance_usdc: Math.round(Number(data.balanceAfter) * 1_000_000) }
            : prev,
        );
        balanceUnitsRef.current = Math.round(Number(data.balanceAfter) * 1_000_000);

        ballsInFlightRef.current = Math.max(0, ballsInFlightRef.current - 1);
        setBallsInFlight(ballsInFlightRef.current);

        if (ballsInFlightRef.current === 0) {
          droppingRef.current = false;
          const queued = pendingDropsRef.current;
          if (queued.length > 0) {
            pendingDropsRef.current = [];
            setDrops((prev) => {
              const merged = [...queued, ...prev];
              return merged
                .filter((d, i, a) => a.findIndex((x) => x.id === d.id) === i)
                .slice(0, 20);
            });
          }
        }
      });

      // Board at capacity — decrement counter we just incremented
      if (!added) {
        releaseReservation();
        setLastResult(data);
        setBalance((prev) =>
          prev
            ? { ...prev, balance_usdc: Math.round(Number(data.balanceAfter) * 1_000_000) }
            : prev,
        );
        balanceUnitsRef.current = Math.round(Number(data.balanceAfter) * 1_000_000);
        ballsInFlightRef.current = Math.max(0, ballsInFlightRef.current - 1);
        setBallsInFlight(ballsInFlightRef.current);
        if (ballsInFlightRef.current === 0) droppingRef.current = false;
      }
    } catch (err) {
      releaseReservation();
      setError(err instanceof Error ? err.message : 'Drop failed');
      ballsInFlightRef.current = Math.max(0, ballsInFlightRef.current - 1);
      setBallsInFlight(ballsInFlightRef.current);
      if (ballsInFlightRef.current === 0) droppingRef.current = false;
    }
  }

  function startHolding() {
    if (holdIntervalRef.current) return;
    void handleDrop();
    holdIntervalRef.current = setInterval(() => {
      const liveBetUnits = currentBetUnitsRef.current;
      const liveAvailableUnits = Math.max(0, balanceUnitsRef.current - reservedUnitsRef.current);
      if (liveBetUnits === null || liveAvailableUnits < liveBetUnits) {
        stopHolding();
        return;
      }
      void handleDrop();
    }, SPAWN_DELAY_MS);
  }

  function stopHolding() {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }

  // Clean up hold interval on unmount
  useEffect(() => () => stopHolding(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cashout handler ───────────────────────────────────────────────────
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
      balanceUnitsRef.current = 0;
      reservedUnitsRef.current = 0;
      setBalance((prev) => (prev ? { ...prev, balance_usdc: 0 } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cashout failed');
    } finally {
      setCashoutPending(false);
    }
  }

  const canDrop =
    Boolean(userId) &&
    boardReady &&
    !cashoutPending &&
    currentBetUnits !== null &&
    currentBetUnits <= availableBalanceUnits &&
    ballsInFlight < MAX_PLINKO_BALLS;
  const activeSlot = lastResult?.slot ?? null;

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
                ref={boardRef}
                rows={rows}
                activeSlot={activeSlot}
                onReady={() => setBoardReady(true)}
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
                      onClick={() => {
                        setBoardReady(false);
                        setRows(option);
                      }}
                      disabled={ballsInFlight > 0}
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
                  onChange={(e) => setBallValue(e.target.value)}
                  inputMode="decimal"
                  className="pn-input font-mono text-xl"
                />
                <input
                  type="range"
                  min={MIN_BET_USDC}
                  max={maxBet}
                  step="0.10"
                  value={Math.min(Number(ballValue) || MIN_BET_USDC, maxBet)}
                  onChange={(e) => setBallValue(Number(e.target.value).toFixed(2))}
                  disabled={balanceUnits <= 0}
                  className="w-full accent-black"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-2)]">Client seed</span>
                <input
                  value={clientSeed}
                  onChange={(e) => setClientSeed(e.target.value)}
                  maxLength={128}
                  className="pn-input font-mono text-sm"
                />
              </label>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onPointerDown={canDrop ? startHolding : undefined}
                  onPointerUp={stopHolding}
                  onPointerLeave={stopHolding}
                  onPointerCancel={stopHolding}
                  disabled={!canDrop}
                  className="pn-btn pn-btn-primary w-full select-none"
                >
                  {ballsInFlight > 0
                    ? `${ballsInFlight} in flight…`
                    : 'Drop  (hold to keep dropping)'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCashout()}
                  disabled={!userId || balanceUnits <= 0 || cashoutPending}
                  className="pn-btn pn-btn-secondary w-full"
                >
                  {cashoutPending ? 'Cashing out…' : 'Cash Out'}
                </button>
              </div>

              {lastResult && (
                <div className="border-t border-[var(--line)] pt-4 text-sm">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-2)]">Last drop</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs">
                    <span>Slot</span><span className="text-right">{lastResult.slot}</span>
                    <span>Multiplier</span>
                    <span className="text-right" style={{ color: multiplierColor(lastResult.multiplier) }}>
                      {lastResult.multiplier}x
                    </span>
                    <span>Payout</span><span className="text-right">{lastResult.payout}</span>
                    <span>Seed hash</span>
                    <span className="truncate text-right">{compactHash(lastResult.serverSeedHash)}</span>
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
                        {unitsToUsdc(drop.ball_value_usdc)} → {unitsToUsdc(drop.payout_usdc)} USDC
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

          {(message ?? error) && (
            <p
              className={`mt-5 border p-3 text-sm ${
                error
                  ? 'border-[var(--danger)] text-[var(--danger)]'
                  : 'border-black text-[var(--ink-0)]'
              }`}
            >
              {error ?? message}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
