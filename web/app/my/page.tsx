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
