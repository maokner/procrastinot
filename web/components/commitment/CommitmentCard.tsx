import Link from 'next/link';
import type { Commitment, Profile } from '@/lib/db-types';
import { DeadlineCountdown } from './DeadlineCountdown';

type ViewerRole = 'creator' | 'enemy';

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-white/80 text-[var(--ink-1)] border-[var(--line)]',
  completed: 'bg-[color-mix(in_srgb,var(--success)_12%,white)] text-[var(--success)] border-[color-mix(in_srgb,var(--success)_35%,var(--line))]',
  forfeited: 'bg-[color-mix(in_srgb,var(--danger)_10%,white)] text-[var(--danger)] border-[color-mix(in_srgb,var(--danger)_35%,var(--line))]',
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
    <li className="border-b border-[var(--line)] py-4 last:border-none">
      <Link
        href={`/c/${commitment.id}`}
        prefetch
        className="flex flex-col gap-2 transition hover:opacity-80"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">#{commitment.id}</span>
          <span
            className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_CLASS[commitment.status] ?? ''}`}
          >
            {commitment.status}
          </span>
        </div>
        <p className="line-clamp-2 text-sm text-[var(--ink-1)]">{commitment.task}</p>
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--ink-2)]">
            {otherRoleLabel}{' '}
            <span className={role === 'creator' ? 'text-[var(--danger)]' : 'text-[var(--ink-1)]'}>
              {otherLabel}
            </span>
          </span>
          <span className="flex items-center gap-3 text-[var(--ink-2)]">
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
