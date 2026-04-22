import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';
import { getProfileStats, listPublicCommitments, getEnemyStats, profilesByIds } from '@/lib/commitments';
import { CommitmentCard } from '@/components/commitment/CommitmentCard';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ username: string }> };

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params;
  const cookieJar = await cookies();
  const supabase = supabaseServer(cookieJar);
  const { data: raw, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, created_at')
    .eq('username', username)
    .maybeSingle();

  const data = raw as
    | { id: string; username: string; display_name: string | null; avatar_url: string | null; created_at: string }
    | null;

  if (error || !data) notFound();

  const [stats, commitments, enemyStats] = await Promise.all([
    getProfileStats(data.id),
    listPublicCommitments(data.id),
    getEnemyStats(data.id),
  ]);

  const enemyProfiles = await profilesByIds(commitments.map(c => c.enemy_profile));

  const active = commitments.filter(c => c.status === 'active');
  const past = commitments.filter(c => c.status !== 'active');

  const displayName = data.display_name?.trim() || `@${data.username}`;
  const memberSince = new Date(data.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <main className="pn-page max-w-4xl">
      <Link href="/my" className="pn-backlink mb-6">← Back to my commitments</Link>

      {/* Profile header */}
      <section className="pn-panel flex items-center gap-5 rounded-2xl p-6 mb-6">
        {data.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.avatar_url}
            alt={`@${data.username}`}
            className="h-20 w-20 rounded-full border border-[var(--line)] object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[var(--line)] bg-white/70 text-2xl font-semibold uppercase">
            {data.username.slice(0, 1)}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <h1 className="pn-title text-4xl">{displayName}</h1>
          <span className="font-mono text-sm text-[var(--ink-2)]">@{data.username}</span>
          <span className="text-xs text-[var(--ink-2)]">Member since {memberSince}</span>
        </div>
      </section>

      {/* Stat grid */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {([
          { label: 'Commitments', value: String(stats.total) },
          { label: 'Pass rate', value: `${stats.passRate}%` },
          { label: 'Total staked', value: `${fmt(stats.totalStaked)} USDC` },
          { label: 'Total forfeited', value: `${fmt(stats.totalForfeited)} USDC` },
        ] as const).map(({ label, value }) => (
          <div key={label} className="pn-panel rounded-xl p-4 flex flex-col gap-1">
            <span className="text-xs text-[var(--ink-2)] uppercase tracking-wide">{label}</span>
            <span className="text-xl font-semibold">{value}</span>
          </div>
        ))}
      </section>

      {/* Enemy stats */}
      {enemyStats.timesNamed > 0 && (
        <section className="pn-panel rounded-xl p-4 mb-6 flex flex-wrap gap-6 text-sm">
          <div>
            <span className="text-[var(--ink-2)]">Times named as enemy: </span>
            <span className="font-semibold">{enemyStats.timesNamed}</span>
          </div>
          <div>
            <span className="text-[var(--ink-2)]">USDC claimed from forfeits: </span>
            <span className="font-semibold">{fmt(enemyStats.totalClaimed)} USDC</span>
          </div>
        </section>
      )}

      {/* Active commitments */}
      {active.length > 0 && (
        <section className="pn-panel rounded-2xl px-6 mb-6">
          <h2 className="pn-label py-4 border-b border-[var(--line)]">Active</h2>
          <ul>
            {active.map(c => (
              <CommitmentCard
                key={c.id}
                commitment={c}
                role="creator"
                counterparty={c.enemy_profile ? enemyProfiles.get(c.enemy_profile) : null}
              />
            ))}
          </ul>
        </section>
      )}

      {/* Past commitments */}
      {past.length > 0 && (
        <section className="pn-panel rounded-2xl px-6">
          <h2 className="pn-label py-4 border-b border-[var(--line)]">Past</h2>
          <ul>
            {past.map(c => (
              <CommitmentCard
                key={c.id}
                commitment={c}
                role="creator"
                counterparty={c.enemy_profile ? enemyProfiles.get(c.enemy_profile) : null}
              />
            ))}
          </ul>
        </section>
      )}

      {commitments.length === 0 && (
        <p className="text-sm text-[var(--ink-2)] text-center py-12">No commitments yet.</p>
      )}
    </main>
  );
}
