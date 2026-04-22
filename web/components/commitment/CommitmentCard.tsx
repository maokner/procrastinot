import Link from 'next/link';
import type { Commitment, Profile } from '@/lib/db-types';
import { DeadlineCountdown } from './DeadlineCountdown';

type ViewerRole = 'creator' | 'enemy';

const STATUS_CLASS: Record<string, string> = {
  active: 'border-black bg-black text-white',
  completed: 'border-black bg-white text-black',
  forfeited: 'border-black bg-[var(--bg-1)] text-[var(--ink-1)]',
};

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function CommitmentCard({
  commitment,
  role,
  counterparty,
}: {
  commitment: Commitment;
  role: ViewerRole;
  counterparty?: Pick<Profile, 'username' | 'display_name'> | null;
}) {
  const otherLabel =
    counterparty?.username != null
      ? `@${counterparty.username}`
      : shortAddr(role === 'creator' ? commitment.enemy_address : commitment.creator_address);
  const otherRoleLabel = role === 'creator' ? 'enemy' : 'creator';

  return (
    <li className="border-b border-[var(--line)] py-5 last:border-none">
      <Link
        href={`/c/${commitment.id}`}
        prefetch
        className="flex flex-col gap-3 transition hover:bg-[var(--bg-1)]"
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs uppercase tracking-[0.16em]">#{commitment.id}</span>
          <span
            className={`inline-block border px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.16em] ${STATUS_CLASS[commitment.status] ?? ''}`}
          >
            {commitment.status}
          </span>
        </div>
        <p className="line-clamp-2 text-lg leading-snug text-[var(--ink-1)]">{commitment.task}</p>
        <div className="flex items-center justify-between gap-4 text-xs">
          <span className="text-[var(--ink-2)]">
            {otherRoleLabel}{' '}
            <span className={role === 'creator' ? 'font-mono text-[var(--ink-0)]' : 'text-[var(--ink-1)]'}>
              {otherLabel}
            </span>
          </span>
          <span className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--ink-2)]">
            <span>{commitment.stake} USDC</span>
            {commitment.status === 'active' && (
              <DeadlineCountdown
                deadline={commitment.deadline}
                className="text-[var(--ink-2)]"
              />
            )}
          </span>
        </div>
      </Link>
    </li>
  );
}
