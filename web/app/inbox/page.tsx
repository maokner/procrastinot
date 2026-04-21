import { redirect } from 'next/navigation';
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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      <h1 className="mb-2 text-2xl font-semibold">Inbox</h1>
      <p className="mb-6 text-sm text-neutral-500">
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
