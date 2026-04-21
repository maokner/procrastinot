import Link from 'next/link';
import {
  getCommitment,
  getViewerProfile,
  listVerdictEvents,
  profilesByIds,
} from '@/lib/commitments';
import { LiveCommitment } from '@/components/commitment/LiveCommitment';
import { CHAIN_ID } from '@/lib/contract';

export const dynamic = 'force-dynamic';

export default async function CommitmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Validate id up-front.
  let idNum: number;
  try {
    idNum = Number(BigInt(id));
  } catch {
    return (
      <Shell>
        <p className="text-red-400">Invalid commitment id.</p>
      </Shell>
    );
  }

  const [viewer, commitment] = await Promise.all([
    getViewerProfile(),
    getCommitment(idNum),
  ]);

  if (!commitment) {
    return (
      <Shell>
        <div className="flex flex-col items-start gap-3">
          <h1 className="text-xl font-semibold">Indexing…</h1>
          <p className="text-sm text-neutral-400">
            This commitment hasn&apos;t landed in the database yet. The indexer
            typically catches up within 5&nbsp;seconds.
          </p>
          <Link
            href={`/c/${id}`}
            prefetch={false}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-900"
          >
            Retry
          </Link>
        </div>
      </Shell>
    );
  }

  const events = await listVerdictEvents(idNum);
  const profileMap = await profilesByIds([
    commitment.creator_profile,
    commitment.enemy_profile,
  ]);
  const creator = commitment.creator_profile
    ? profileMap.get(commitment.creator_profile)
    : null;
  const enemy = commitment.enemy_profile
    ? profileMap.get(commitment.enemy_profile)
    : null;

  return (
    <Shell>
      <LiveCommitment
        initial={commitment}
        initialEvents={events}
        creatorUsername={creator?.username ?? null}
        enemyUsername={enemy?.username ?? null}
        viewerProfileId={viewer?.id ?? null}
        chainId={CHAIN_ID}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
      {children}
    </main>
  );
}
