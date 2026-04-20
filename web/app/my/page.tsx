import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getViewerProfile,
  listMyCommitments,
  profilesByIds,
} from '@/lib/commitments';
import { CommitmentCard } from '@/components/commitment/CommitmentCard';

export const dynamic = 'force-dynamic';

export default async function MyPage() {
  const viewer = await getViewerProfile();
  if (!viewer) redirect('/login?next=/my');

  const commitments = await listMyCommitments(viewer.id, 50);
  const profileMap = await profilesByIds([
    ...commitments.map((c) => c.creator_profile),
    ...commitments.map((c) => c.enemy_profile),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <Link
          href="/"
          prefetch
          className="font-mono text-sm uppercase tracking-widest"
        >
          procrastinot
        </Link>
        <nav className="flex items-center gap-4 text-sm text-neutral-400">
          <Link href="/inbox" prefetch className="hover:text-neutral-100">
            Inbox
          </Link>
          <Link
            href="/create"
            prefetch
            className="rounded bg-neutral-100 px-3 py-1.5 font-medium text-neutral-950 hover:bg-white"
          >
            New
          </Link>
        </nav>
      </header>

      <h1 className="mb-6 text-2xl font-semibold">My commitments</h1>

      {commitments.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-neutral-400">No commitments yet.</p>
          <Link
            href="/create"
            prefetch
            className="rounded bg-neutral-100 px-4 py-2 text-neutral-950 hover:bg-white"
          >
            Create one
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {commitments.map((c) => {
            const role: 'creator' | 'enemy' =
              c.creator_profile === viewer.id ? 'creator' : 'enemy';
            const counterpartyId =
              role === 'creator' ? c.enemy_profile : c.creator_profile;
            const counterparty = counterpartyId ? profileMap.get(counterpartyId) : null;
            return (
              <CommitmentCard
                key={c.id}
                commitment={c}
                role={role}
                counterparty={counterparty}
              />
            );
          })}
        </ul>
      )}
    </main>
  );
}
