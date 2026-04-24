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
}: Props) {
  const { address } = useAccount();
  const router = useRouter();
  const [commitment, setCommitment] = useState<Commitment>(initial);
  const [events, setEvents] = useState<VerdictEvent[]>(initialEvents);

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
  const canSubmit =
    isCreator && isActive && !deadlinePassed && commitment.attempts_used < ATTEMPT_CAP;
  const canForfeit = isCreator && isActive && deadlinePassed;
  const canClaim = isEnemy && isActive && deadlinePassed;

  const idBig = BigInt(commitment.id);

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
