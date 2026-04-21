import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  getViewerProfile,
  listInboxActive,
  listInboxHistory,
  profilesByIds,
} from '@/lib/commitments';
import { InboxList } from '@/components/commitment/InboxList';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const viewer = await getViewerProfile();
  if (!viewer) redirect('/login?next=/inbox');

  const [active, history] = await Promise.all([
    listInboxActive(viewer.id),
    listInboxHistory(viewer.id, 50),
  ]);

  const creatorIds = [
    ...active.map((c) => c.creator_profile),
    ...history.map((c) => c.creator_profile),
  ];
  const profileMap = await profilesByIds(creatorIds);
  const creatorMap: Record<string, { username: string | null } | null> = {};
  for (const [id, p] of profileMap.entries()) {
    creatorMap[id] = { username: p.username };
  }

  return (
    <main className="pn-page max-w-5xl">
      <Link href="/my" className="pn-backlink mb-5">← Back to my commitments</Link>
      <h1 className="pn-title mb-2 text-5xl">Inbox</h1>
      <p className="pn-copy mb-7 max-w-xl">
        Commitments where you&apos;re the enemy. Past the deadline, you can
        claim the stake.
      </p>

      <InboxList
        viewerProfileId={viewer.id}
        initialActive={active}
        initialHistory={history}
        creatorMap={creatorMap}
      />
    </main>
  );
}
