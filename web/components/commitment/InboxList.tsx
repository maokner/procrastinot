'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';
import type { Commitment, Profile } from '@/lib/db-types';
import { DeadlineCountdown } from './DeadlineCountdown';
import { ClaimButton } from './ForfeitButton';

type Props = {
  viewerProfileId: string;
  initialActive: Commitment[];
  initialHistory: Commitment[];
  creatorMap: Record<string, Pick<Profile, 'username'> | null>;
};

type Tab = 'active' | 'history';

/**
 * Live inbox view. Active tab realtime-subscribes to commitments where
 * enemy_profile = viewer. Realtime filter fires on UPDATE too so status
 * flips (completed / forfeited) automatically remove rows.
 */
export function InboxList({
  viewerProfileId,
  initialActive,
  initialHistory,
  creatorMap,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('active');
  const [active, setActive] = useState(initialActive);
  const [history, setHistory] = useState(initialHistory);

  useEffect(() => {
    const sb = supabaseBrowser();
    // Filter by enemy_profile so we only get our rows. No firehose.
    const channel = sb
      .channel(`inbox-${viewerProfileId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'commitments',
          filter: `enemy_profile=eq.${viewerProfileId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as Commitment;
          if (!row) return;
          setActive((prev) => {
            const withoutRow = prev.filter((r) => r.id !== row.id);
            if (payload.eventType !== 'DELETE' && (payload.new as Commitment)?.status === 'active') {
              return [...withoutRow, payload.new as Commitment].sort(
                (a, b) => +new Date(a.deadline) - +new Date(b.deadline),
              );
            }
            return withoutRow;
          });
          setHistory((prev) => {
            const withoutRow = prev.filter((r) => r.id !== row.id);
            if (
              payload.eventType !== 'DELETE' &&
              (payload.new as Commitment)?.status &&
              (payload.new as Commitment).status !== 'active'
            ) {
              return [payload.new as Commitment, ...withoutRow];
            }
            return withoutRow;
          });
        },
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [viewerProfileId]);

  const rows = tab === 'active' ? active : history;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 border-b-4 border-black text-sm">
        <TabButton selected={tab === 'active'} onClick={() => setTab('active')}>
          Active ({active.length})
        </TabButton>
        <TabButton selected={tab === 'history'} onClick={() => setTab('history')}>
          History ({history.length})
        </TabButton>
      </div>

      {rows.length === 0 ? (
        <p className="text-[var(--ink-2)]">
          {tab === 'active'
            ? 'No one has put you on the hook yet.'
            : 'No past commitments.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((c) => {
            const creator = c.creator_profile
              ? creatorMap[c.creator_profile] ?? null
              : null;
            return (
              <InboxRow
                key={c.id}
                commitment={c}
                creatorUsername={creator?.username ?? null}
                onExpire={() => router.refresh()}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-[4px] border-b-4 px-3 py-3 font-mono text-[11px] uppercase tracking-[0.14em] ${
        selected
          ? 'border-black text-[var(--ink-0)]'
          : 'border-transparent text-[var(--ink-2)] hover:text-[var(--ink-0)]'
      }`}
    >
      {children}
    </button>
  );
}

function InboxRow({
  commitment,
  creatorUsername,
  onExpire,
}: {
  commitment: Commitment;
  creatorUsername: string | null;
  onExpire?: () => void;
}) {
  const deadlineSec = Math.floor(new Date(commitment.deadline).getTime() / 1000);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const canClaim = commitment.status === 'active' && now >= deadlineSec;

  return (
    <li className="flex flex-col gap-3 border-b border-[var(--line)] py-5 last:border-none">
      <div className="flex items-center justify-between">
        <Link
          href={`/c/${commitment.id}`}
          prefetch
          className="font-mono text-xs uppercase tracking-[0.16em] hover:opacity-90"
        >
          #{commitment.id}
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-2)]">
          from{' '}
          {creatorUsername ? (
            <span className="text-[var(--ink-1)]">@{creatorUsername}</span>
          ) : (
            <span className="font-mono">
              {commitment.creator_address.slice(0, 6)}…
              {commitment.creator_address.slice(-4)}
            </span>
          )}
        </span>
      </div>
      <p className="line-clamp-2 text-lg leading-snug text-[var(--ink-1)]">{commitment.task}</p>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-2)]">
          {commitment.status === 'active' ? (
            <>
              <DeadlineCountdown
                deadline={commitment.deadline}
                onExpire={onExpire}
                className="text-[var(--ink-1)]"
              />{' '}
              until claimable
            </>
          ) : (
            <span className="uppercase tracking-wide">{commitment.status}</span>
          )}
        </span>
        {commitment.status === 'active' && (
          <ClaimButton
            id={BigInt(commitment.id)}
            disabled={!canClaim}
            label={
              canClaim
                ? `Claim ${commitment.stake} USDC`
                : 'Waiting for deadline'
            }
          />
        )}
      </div>
    </li>
  );
}
