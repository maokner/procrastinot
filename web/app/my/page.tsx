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
    <main className="pn-page max-w-5xl">
      <Link href="/" className="pn-backlink mb-5">← Back to home</Link>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b-4 border-black pb-6">
        <div>
          <p className="pn-kicker mb-2">Workspace</p>
          <h1 className="pn-title text-5xl sm:text-6xl">My commitments</h1>
          <p className="pn-copy mt-4 max-w-2xl">
            The active ledger of everything you have put at risk.
          </p>
        </div>
        <Link href="/create" prefetch className="pn-btn pn-btn-primary">
          New commitment
        </Link>
      </div>

      {commitments.length === 0 ? (
        <section className="pn-panel p-6 md:p-8">
          <p className="pn-kicker mb-3">Empty state</p>
          <p className="pn-copy mb-4 max-w-xl">
            No commitments yet. Start with one deliverable and one consequence.
          </p>
          <Link href="/create" prefetch className="pn-btn pn-btn-primary">
            Create one
          </Link>
        </section>
      ) : (
        <ul className="flex flex-col border-t-4 border-black">
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
