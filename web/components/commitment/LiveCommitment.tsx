'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { supabaseBrowser } from '@/lib/supabase';
import type { Commitment, VerdictEvent } from '@/lib/db-types';
import { DeadlineCountdown } from './DeadlineCountdown';
import { SubmitEvidenceForm } from './SubmitEvidenceForm';
import { ForfeitButton, ClaimButton } from './ForfeitButton';
import { VerdictLog } from './VerdictLog';

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-neutral-800 text-neutral-200 border-neutral-700',
  completed: 'bg-green-950 text-green-300 border-green-900',
  forfeited: 'bg-red-950 text-red-300 border-red-900',
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
          setCommitment(payload.new as Commitment);
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Commitment #{commitment.id}</h1>
        <span
          className={`inline-block rounded border px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${STATUS_CLASS[commitment.status] ?? ''}`}
        >
          {commitment.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded border border-neutral-800 bg-neutral-950 p-4 text-sm">
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
              <span className="text-neutral-100">@{creatorUsername}</span>
            ) : (
              shortAddr(commitment.creator_address)
            )}
          </span>
        </Field>
        <Field label="Enemy">
          <span className="font-mono text-xs text-red-300">
            {enemyUsername ? `@${enemyUsername}` : shortAddr(commitment.enemy_address)}
          </span>
        </Field>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Task
        </h2>
        <p className="whitespace-pre-wrap text-neutral-100">{commitment.task}</p>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Rubric
        </h2>
        <p className="whitespace-pre-wrap text-neutral-300">{commitment.rubric}</p>
      </section>

      {canSubmit && <SubmitEvidenceForm id={idBig} />}
      {canForfeit && <ForfeitButton id={idBig} />}
      {canClaim && <ClaimButton id={idBig} label={`Claim ${commitment.stake} USDC`} />}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Verdict history
        </h2>
        <VerdictLog events={events} chainId={chainId} />
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
      <span>{children}</span>
    </div>
  );
}
