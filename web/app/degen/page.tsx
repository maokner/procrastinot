'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase';
import type { DegenBalance, PlinkoDrop } from '@/lib/db-types';
import {
  DEFAULT_RISK,
  MIN_BET_USDC,
  PLINKO_ROWS,
  RISK_LEVELS,
  type PlinkoRows,
  type RiskLevel,
  expectedValue,
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
  risk: RiskLevel;
  slot: number;
  multiplier: number;
  multipliers: number[];
  payout: string;
  balanceBefore: string;
  balanceAfter: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  trajectory: number[][];
  pegHits: { frame: number; x: number; y: number }[];
};

type Flash = { key: number; result: 'win' | 'miss'; multiplier: number };

function compactHash(hash: string) {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

export default function DegenPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [balance, setBalance] = useState<DegenBalance | null>(null);
  const [drops, setDrops] = useState<PlinkoDrop[]>([]);
  const [rows, setRows] = useState<PlinkoRows>(12);
  const [risk, setRisk] = useState<RiskLevel>(DEFAULT_RISK);
  const [ballValue, setBallValue] = useState('0.10');
  const [clientSeed, setClientSeed] = useState('procrastinot');
  const [ballsInFlight, setBallsInFlight] = useState(0);
  const [cashoutPending, setCashoutPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<DropResult | null>(null);
  const [boardReady, setBoardReady] = useState(false);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [creditPending, setCreditPending] = useState(false);

  const boardRef = useRef<PlinkoBoardHandle>(null);
  const droppingRef = useRef(false);
  const pendingDropsRef = useRef<PlinkoDrop[]>([]);
  const ballsInFlightRef = useRef(0);
  const balanceUnitsRef = useRef(0);
  const currentBetUnitsRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashSeqRef = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Optimistic balance helpers — debit on drop click, credit on land.
  function applyBalanceDelta(deltaUnits: number) {
    balanceUnitsRef.current = Math.max(0, balanceUnitsRef.current + deltaUnits);
    setBalance((prev) =>
      prev
        ? { ...prev, balance_usdc: Math.max(0, prev.balance_usdc + deltaUnits) }
        : prev,
    );
  }

  function triggerFlash(multiplier: number) {
    const next: Flash = {
      key: ++flashSeqRef.current,
      result: multiplier >= 1 ? 'win' : 'miss',
      multiplier,
    };
    setFlash(next);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 700);
  }

  // ── Pending credit indicator ─────────────────────────────────────────────
  // When the user just clicked "Enter degen mode", LiveCommitment redirects
  // here with `?pending=<commitmentId>` while the oracle settles in the
  // background. The flag clears on the first realtime balance update or
  // after a 60s safety timeout.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('pending')) return;
    setCreditPending(true);
    const timeout = window.setTimeout(() => setCreditPending(false), 60_000);
    return () => window.clearTimeout(timeout);
  }, []);

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
          .limit(6),
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
          setCreditPending(false);
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
            setDrops((prev) => [next, ...prev.filter((d) => d.id !== next.id)].slice(0, 6));
          }
        },
      )
      .subscribe();

    return () => { void sb.removeChannel(channel); };
  }, [userId]);

  const balanceUnits = balance?.balance_usdc ?? 0;
  // Balance is already optimistic (debited on Drop click, credited on land)
  // so the "available" balance is simply the current display value.
  const availableBalanceUnits = balanceUnits;
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
  const maxBet = Math.max(MIN_BET_USDC, availableBalanceUnits / 1_000_000);

  // ── Drop handler ───────────────────────────────────────────────────────
  async function handleDrop() {
    const liveBetUnits = currentBetUnitsRef.current;
    if (
      liveBetUnits === null ||
      liveBetUnits > balanceUnitsRef.current ||
      ballsInFlightRef.current >= MAX_PLINKO_BALLS
    ) {
      return;
    }

    setError(null);
    setMessage(null);

    // Debit the bet immediately so the balance reads as "spent" right as the
    // user clicks. The ball will later credit its payout when it lands.
    applyBalanceDelta(-liveBetUnits);

    ballsInFlightRef.current++;
    droppingRef.current = true;
    setBallsInFlight(ballsInFlightRef.current);

    try {
      const res = await fetch('/api/plinko/drop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, ballValue, clientSeed, risk }),
      });
      const data = (await res.json()) as DropResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Drop failed');

      const payoutUnits = Math.round(Number(data.payout) * 1_000_000);

      const creditPayout = (slot: number) => {
        setLastResult({ ...data, slot });
        triggerFlash(data.multiplier);
        applyBalanceDelta(payoutUnits);

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
                .slice(0, 6);
            });
          }
        }
      };

      const added = boardRef.current?.addPlaybackBall(
        data.trajectory,
        data.pegHits,
        data.slot,
        creditPayout,
      );

      if (!added) {
        // Board was at capacity — credit payout immediately since no ball
        // will animate for this drop.
        creditPayout(data.slot);
      }
    } catch (err) {
      // Refund the optimistic debit.
      applyBalanceDelta(liveBetUnits);
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
      if (liveBetUnits === null || balanceUnitsRef.current < liveBetUnits) {
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

  useEffect(
    () => () => {
      stopHolding();
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  ); // eslint-disable-line react-hooks/exhaustive-deps

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
    <main className="pn-degen min-h-screen">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <Link
          href="/my"
          className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--degen-ink-dim)] hover:text-[var(--degen-accent)]"
        >
          ← Back to commitments
        </Link>

        <header className="pn-degen-marquee mt-5 mb-8 flex flex-wrap items-end justify-between gap-4 pb-5">
          <div>
            <p className="pn-kicker mb-1">Degen Mode</p>
            <h1 className="font-mono text-5xl font-bold tracking-tight sm:text-6xl">
              Plinko
            </h1>
          </div>
          <div className="text-right">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--degen-ink-dim)]">
              Playing balance
            </p>
            <p className="font-mono text-4xl font-semibold text-[var(--degen-accent)]">
              {balanceText}
            </p>
            <p className="font-mono text-[11px] text-[var(--degen-ink-dim)]">USDC</p>
            {creditPending && (
              <p className="mt-1 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--degen-accent)]">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--degen-accent)]" />
                Crediting…
              </p>
            )}
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="min-w-0">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="pn-degen-board-frame relative">
                <PlinkoBoard
                  ref={boardRef}
                  rows={rows}
                  riskLevel={risk}
                  activeSlot={activeSlot}
                  onReady={() => setBoardReady(true)}
                />
                {flash && (
                  <div
                    key={flash.key}
                    className="pn-degen-flash"
                    data-result={flash.result}
                  >
                    {flash.result === 'win'
                      ? `${flash.multiplier}x`
                      : 'MISS'}
                  </div>
                )}
              </div>

              <aside className="flex flex-col gap-5">
                <div>
                  <p className="pn-kicker mb-2">Rows</p>
                  <div className="grid grid-cols-3 gap-2">
                    {PLINKO_ROWS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="pn-degen-pill"
                        data-active={rows === option}
                        disabled={ballsInFlight > 0}
                        onClick={() => {
                          setBoardReady(false);
                          setRows(option);
                        }}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="pn-kicker mb-2">Risk</p>
                  <div className="grid grid-cols-3 gap-2">
                    {RISK_LEVELS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="pn-degen-pill capitalize"
                        data-active={risk === option}
                        disabled={ballsInFlight > 0}
                        onClick={() => setRisk(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 font-mono text-[10px] text-[var(--degen-ink-dim)]">
                    EV {(expectedValue(rows, risk) * 100).toFixed(1)}% per drop · house edge{' '}
                    {((1 - expectedValue(rows, risk)) * 100).toFixed(1)}%
                  </p>
                </div>

                <label className="flex flex-col gap-2">
                  <span className="pn-kicker">Ball value</span>
                  <input
                    value={ballValue}
                    onChange={(e) => setBallValue(e.target.value)}
                    inputMode="decimal"
                    className="pn-degen-input text-xl"
                  />
                  <input
                    type="range"
                    min={MIN_BET_USDC}
                    max={maxBet}
                    step="0.10"
                    value={Math.min(Number(ballValue) || MIN_BET_USDC, maxBet)}
                    onChange={(e) => setBallValue(Number(e.target.value).toFixed(2))}
                    disabled={balanceUnits <= 0}
                    className="w-full accent-[var(--degen-accent)]"
                  />
                </label>

                <label className="flex flex-col gap-2">
                  <span className="pn-kicker">Client seed</span>
                  <input
                    value={clientSeed}
                    onChange={(e) => setClientSeed(e.target.value)}
                    maxLength={128}
                    className="pn-degen-input text-sm"
                  />
                </label>

                <div className="pn-degen-mobile-sticky flex flex-col gap-2 md:static md:m-0 md:border-0 md:bg-transparent md:p-0">
                  <button
                    type="button"
                    onPointerDown={canDrop ? startHolding : undefined}
                    onPointerUp={stopHolding}
                    onPointerLeave={stopHolding}
                    onPointerCancel={stopHolding}
                    disabled={!canDrop}
                    className="pn-degen-btn pn-degen-btn-primary w-full select-none"
                  >
                    {ballsInFlight > 0
                      ? `${ballsInFlight} in flight…`
                      : 'Drop  (hold to repeat)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCashout()}
                    disabled={!userId || balanceUnits <= 0 || cashoutPending}
                    className="pn-degen-btn w-full"
                  >
                    {cashoutPending ? 'Cashing out…' : 'Cash Out'}
                  </button>
                </div>

                {lastResult && (
                  <div className="pn-degen-card p-3 text-sm">
                    <p className="pn-kicker mb-2">Last drop</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-xs">
                      <span className="text-[var(--degen-ink-dim)]">Slot</span>
                      <span className="text-right">{lastResult.slot}</span>
                      <span className="text-[var(--degen-ink-dim)]">Multiplier</span>
                      <span
                        className="text-right"
                        style={{ color: multiplierColor(lastResult.multiplier) }}
                      >
                        {lastResult.multiplier}x
                      </span>
                      <span className="text-[var(--degen-ink-dim)]">Payout</span>
                      <span className="text-right">{lastResult.payout}</span>
                      <span className="text-[var(--degen-ink-dim)]">Seed hash</span>
                      <span className="truncate text-right">
                        {compactHash(lastResult.serverSeedHash)}
                      </span>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          </section>

          <section className="pn-degen-card p-4 lg:self-start">
            <h2 className="pn-kicker mb-3">Recent drops</h2>
            {drops.length === 0 ? (
              <p className="font-mono text-sm text-[var(--degen-ink-dim)]">
                No drops yet.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--degen-line)]">
                {drops.map((drop) => {
                  const net = drop.payout_usdc - drop.ball_value_usdc;
                  const mult = Number(drop.multiplier);
                  return (
                    <li key={drop.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-mono text-xs">
                          {unitsToUsdc(drop.ball_value_usdc)} → {unitsToUsdc(drop.payout_usdc)} USDC
                        </p>
                        <p className="truncate font-mono text-[10px] text-[var(--degen-ink-dim)]">
                          {compactHash(drop.server_seed_hash)}
                        </p>
                      </div>
                      <div className="text-right font-mono text-xs">
                        <p style={{ color: multiplierColor(mult) }}>
                          {mult.toFixed(2)}x
                        </p>
                        <p
                          style={{
                            color:
                              net >= 0
                                ? 'var(--degen-win)'
                                : 'var(--degen-loss)',
                          }}
                        >
                          {net >= 0 ? '+' : ''}
                          {unitsToUsdc(net)}
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
                    ? 'border-[var(--degen-loss)] text-[var(--degen-loss)]'
                    : 'border-[var(--degen-accent)] text-[var(--degen-accent)]'
                }`}
              >
                {error ?? message}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
