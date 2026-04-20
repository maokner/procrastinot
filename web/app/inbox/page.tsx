import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getViewerProfile,
  listInboxActive,
  listInboxHistory,
  profilesByIds,
} from '@/lib/commitments';
import { InboxList } from '@/components/commitment/InboxList';
import { ConnectButton } from '@/components/ConnectButton';

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
  const creatorMap: Record<string, { username: string } | null> = {};
  for (const [id, p] of profileMap.entries()) {
    creatorMap[id] = { username: p.username };
  }

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
        <div className="flex items-center gap-3">
          <Link href="/my" prefetch className="text-sm text-neutral-400 hover:text-neutral-100">
            My
          </Link>
          <ConnectButton />
        </div>
      </header>

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
