'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { supabaseBrowser } from '@/lib/supabase';
import type { Commitment, VerdictEvent } from '@/lib/db-types';
import { DeadlineCountdown } from './DeadlineCountdown';
import { SubmitEvidenceForm } from './SubmitEvidenceForm';
import { ForfeitButton, ClaimButton } from './ForfeitButton';
import { VerdictLog } from './VerdictLog';
import type { PassedOracleVerdict } from '@/lib/oracle-verdicts';

const STATUS_CLASS: Record<string, string> = {
  active: 'border-black bg-black text-white',
  completed: 'border-black bg-white text-black',
  forfeited: 'border-black bg-[var(--bg-1)] text-[var(--ink-1)]',
};

const ATTEMPT_CAP = 3;

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

type Props = {
  initial: Commitment;
  initialEvents: VerdictEvent[];
  creatorUsername: string | null;
  enemyUsername: string | null;
  viewerProfileId: string | null;
  chainId: number;
  initialPassedVerdict: PassedOracleVerdict | null;
};

/**
 * Interactive, real-time commitment view. Seeded from Server Component data
 * (instant first paint), then subscribes to Supabase Realtime for the single
 * commitment row + its verdict_events so state transitions land within ~1s.
 */
export function LiveCommitment({
  initial,
  initialEvents,
  creatorUsername,
  enemyUsername,
  viewerProfileId,
  chainId,
  initialPassedVerdict,
}: Props) {
  const { address } = useAccount();
  const router = useRouter();
  const [commitment, setCommitment] = useState<Commitment>(initial);
  const [events, setEvents] = useState<VerdictEvent[]>(initialEvents);
  const [passedVerdict, setPassedVerdict] = useState<PassedOracleVerdict | null>(
    initialPassedVerdict,
  );
  const [settling, setSettling] = useState<'withdraw' | 'degen' | null>(null);
  const [settleMessage, setSettleMessage] = useState<string | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    const channel = sb
      .channel(`commitment-${initial.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'commitments',
          filter: `id=eq.${initial.id}`,
        },
        (payload) => {
          const next = payload.new as Commitment;
          if (next.contract_address?.toLowerCase() !== initial.contract_address.toLowerCase()) {
            return;
          }
          setCommitment(next);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'verdict_events',
          filter: `commitment_id=eq.${initial.id}`,
        },
        (payload) => {
          setEvents((prev) => {
            const ev = payload.new as VerdictEvent;
            if (
              ev.commitment_contract_address?.toLowerCase() !==
              initial.contract_address.toLowerCase()
            ) {
              return prev;
            }
            if (prev.some((e) => e.id === ev.id)) return prev;
            return [...prev, ev].sort((a, b) => a.block_number - b.block_number);
          });
        },
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [initial.id]);

  const isCreator =
    (viewerProfileId && commitment.creator_profile === viewerProfileId) ||
    (address &&
      address.toLowerCase() === commitment.creator_address.toLowerCase());
  const isEnemy =
    (viewerProfileId && commitment.enemy_profile === viewerProfileId) ||
    (address && address.toLowerCase() === commitment.enemy_address.toLowerCase());

  const deadlineSec = Math.floor(new Date(commitment.deadline).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  const deadlinePassed = now >= deadlineSec;
  const isActive = commitment.status === 'active';
  const hasPassedOracleVerdict = Boolean(passedVerdict);
  const canSubmit =
    isCreator &&
    isActive &&
    !deadlinePassed &&
    !hasPassedOracleVerdict &&
    commitment.attempts_used < ATTEMPT_CAP;
  const canSettle = isCreator && isActive && hasPassedOracleVerdict;
  const canForfeit = isCreator && isActive && deadlinePassed && !hasPassedOracleVerdict;
  const canClaim = isEnemy && isActive && deadlinePassed && !hasPassedOracleVerdict;

  const idBig = BigInt(commitment.id);

  useEffect(() => {
    if (!isCreator || !isActive || passedVerdict) return;

    let cancelled = false;
    async function checkVerdict() {
      try {
        const res = await fetch(`/api/commitments/${commitment.id}/oracle-verdict`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          passed?: boolean;
          verdict?: PassedOracleVerdict | null;
        };
        if (!cancelled && data.passed && data.verdict) {
          setPassedVerdict(data.verdict);
          router.refresh();
        }
      } catch {
        // Keep polling; transient network errors should not strand the page.
      }
    }

    void checkVerdict();
    const interval = window.setInterval(checkVerdict, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [commitment.id, isActive, isCreator, passedVerdict, router]);

  async function settle(mode: 'withdraw' | 'degen') {
    setSettling(mode);
    setSettleError(null);
    setSettleMessage(null);

    if (mode === 'degen') {
      // Fire-and-forget the oracle settlement and redirect immediately.
      // /degen subscribes to realtime degen_balances updates and reflects
      // the credit as soon as the oracle writes the row.
      void fetch('/api/degen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitmentId: String(commitment.id) }),
        keepalive: true,
      }).catch(() => {});
      router.push(`/degen?pending=${commitment.id}`);
      return;
    }

    try {
      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commitmentId: String(commitment.id) }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        txHash?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? 'Settlement failed');
      }

      setSettleMessage(
        data.txHash ? `Withdraw submitted. Tx ${shortAddr(data.txHash)}` : 'Withdraw submitted.',
      );
      router.refresh();
    } catch (error) {
      setSettleError(error instanceof Error ? error.message : 'Settlement failed');
    } finally {
      setSettling(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="pn-title text-4xl sm:text-5xl">Commitment #{commitment.id}</h1>
        <span
          className={`inline-block border px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em] ${STATUS_CLASS[commitment.status] ?? ''}`}
        >
          {commitment.status}
        </span>
      </div>

      <div className="pn-panel grid gap-4 p-4 text-sm md:grid-cols-2 md:p-6">
        <Field label="Stake">{commitment.stake} USDC</Field>
        <Field label="Oracle fee (remaining)">{commitment.oracle_fee_remain} USDC</Field>
        <Field label="Attempts">
          {commitment.attempts_used} / {ATTEMPT_CAP}
        </Field>
        <Field label="Deadline">
          <DeadlineCountdown
            deadline={commitment.deadline}
            onExpire={() => router.refresh()}
          />
        </Field>
        <Field label="Creator">
          <span className="font-mono text-xs">
            {creatorUsername ? (
              <span>@{creatorUsername}</span>
            ) : (
              shortAddr(commitment.creator_address)
            )}
          </span>
        </Field>
        <Field label="Enemy">
          <span className="font-mono text-xs">
            {enemyUsername ? `@${enemyUsername}` : shortAddr(commitment.enemy_address)}
          </span>
        </Field>
      </div>

      <section className="border-t-4 border-black pt-5">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-2)]">
          Task
        </h2>
        <p className="whitespace-pre-wrap text-xl leading-relaxed text-[var(--ink-0)]">{commitment.task}</p>
      </section>
      <section className="border-t border-[var(--line)] pt-5">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-2)]">
          Rubric
        </h2>
        <p className="whitespace-pre-wrap text-lg leading-relaxed text-[var(--ink-1)]">{commitment.rubric}</p>
      </section>

      {canSettle && (
        <section className="pn-panel flex flex-col gap-4 rounded-2xl p-5">
          <div>
            <h2 className="text-xl font-bold text-[var(--success)]">Oracle passed this attempt</h2>
            <p className="mt-1 text-sm text-[var(--ink-1)]">
              Choose where the stake should settle.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void settle('withdraw')}
              disabled={settling !== null}
              className="pn-btn pn-btn-primary text-sm disabled:opacity-60"
            >
              {settling === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
            </button>
            <button
              type="button"
              onClick={() => void settle('degen')}
              disabled={settling !== null}
              className="pn-btn pn-btn-secondary text-sm disabled:opacity-60"
            >
              {settling === 'degen' ? 'Entering…' : 'Enter Degen Mode'}
            </button>
          </div>
          {settleMessage && <p className="text-sm text-[var(--success)]">{settleMessage}</p>}
          {settleError && <p className="text-sm text-[var(--danger)]">{settleError}</p>}
        </section>
      )}

      {canSubmit && (
        <SubmitEvidenceForm
          id={idBig}
          viewerProfileId={viewerProfileId}
          attempt={commitment.attempts_used + 1}
        />
      )}
      {canForfeit && <ForfeitButton id={idBig} />}
      {canClaim && <ClaimButton id={idBig} label={`Claim ${commitment.stake} USDC`} />}

      <section className="border-t border-[var(--line)] pt-5">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-[var(--ink-2)]">
          Verdict history
        </h2>
        <VerdictLog events={events} chainId={chainId} />
      </section>

      <div className="flex flex-wrap gap-2 border-t-4 border-black pt-4">
        <Link href="/create" className="pn-btn pn-btn-secondary text-sm">
          Create next commitment
        </Link>
        <Link href="/inbox" className="pn-btn pn-btn-secondary text-sm">
          Open inbox
        </Link>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-2)]">{label}</span>
      <span>{children}</span>
    </div>
  );
}
