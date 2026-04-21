import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ username: string }> };

export default async function PublicProfilePage({ params }: Props) {
  const { username } = await params;
  // `profiles` is readable by anon, so the cookie-less server client is fine
  // here, but we route through supabaseServer() for consistent session
  // cookie handling (e.g. "View my own profile" rendering).
  const cookieJar = await cookies();
  const supabase = supabaseServer(cookieJar);
  const { data: raw, error } = await supabase
    .from('profiles')
    .select('username, display_name, avatar_url, created_at')
    .eq('username', username)
    .maybeSingle();

  const data = raw as
    | { username: string; display_name: string | null; avatar_url: string | null; created_at: string }
    | null;

  if (error || !data) notFound();

  const displayName = data.display_name?.trim() || `@${data.username}`;

  return (
    <main className="pn-page max-w-4xl">
      <Link href="/my" className="pn-backlink mb-6">← Back to my commitments</Link>
      <section className="pn-panel flex items-center gap-5 rounded-2xl p-6">
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
        <div className="flex flex-col">
          <h1 className="pn-title text-4xl">{displayName}</h1>
          <span className="font-mono text-sm text-[var(--ink-2)]">@{data.username}</span>
        </div>
      </section>
    </main>
  );
}
