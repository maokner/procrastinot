import Link from 'next/link';
import type { Commitment, Profile } from '@/lib/db-types';
import { DeadlineCountdown } from './DeadlineCountdown';

type ViewerRole = 'creator' | 'enemy';

const STATUS_CLASS: Record<string, string> = {
  active: 'bg-neutral-800 text-neutral-200 border-neutral-700',
  completed: 'bg-green-950 text-green-300 border-green-900',
  forfeited: 'bg-red-950 text-red-300 border-red-900',
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
    <li className="rounded border border-neutral-800 bg-neutral-950 p-4">
      <Link
        href={`/c/${commitment.id}`}
        prefetch
        className="flex flex-col gap-2 hover:opacity-90"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">#{commitment.id}</span>
          <span
            className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_CLASS[commitment.status] ?? ''}`}
          >
            {commitment.status}
          </span>
        </div>
        <p className="line-clamp-2 text-sm text-neutral-300">{commitment.task}</p>
        <div className="flex items-center justify-between text-xs">
          <span className="text-neutral-500">
            {otherRoleLabel}{' '}
            <span className={role === 'creator' ? 'text-red-300' : 'text-neutral-300'}>
              {otherLabel}
            </span>
          </span>
          <span className="flex items-center gap-3 text-neutral-400">
            <span>{commitment.stake} USDC</span>
            {commitment.status === 'active' && (
              <DeadlineCountdown
                deadline={commitment.deadline}
                className="text-neutral-400"
              />
            )}
          </span>
        </div>
      </Link>
    </li>
  );
}
