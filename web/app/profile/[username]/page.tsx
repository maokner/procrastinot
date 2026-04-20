import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="font-mono text-sm uppercase tracking-widest">
          procrastinot
        </Link>
      </header>

      <section className="flex items-center gap-5">
        {data.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.avatar_url}
            alt={`@${data.username}`}
            className="h-20 w-20 rounded-full border border-neutral-800 object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900 text-2xl font-semibold uppercase">
            {data.username.slice(0, 1)}
          </div>
        )}
        <div className="flex flex-col">
          <h1 className="text-3xl font-semibold tracking-tight">{displayName}</h1>
          <span className="font-mono text-sm text-neutral-400">@{data.username}</span>
        </div>
      </section>
    </main>
  );
}
