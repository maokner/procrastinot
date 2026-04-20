import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getProfile, getWallet, requireSession } from '@/lib/auth';
import { OnboardingClient } from '@/components/auth/OnboardingClient';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const cookieJar = await cookies();
  const user = await requireSession(cookieJar, '/onboarding');
  const profile = await getProfile(cookieJar, user.id);
  const wallet = await getWallet(cookieJar, user.id);

  if (profile && wallet) redirect('/my');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="font-mono text-sm uppercase tracking-widest">
          procrastinot
        </Link>
      </header>
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">Welcome</h1>
      <p className="mb-8 text-sm text-neutral-400">
        Two quick steps and you&apos;re in.
      </p>
      <OnboardingClient userId={user.id} initialUsername={profile?.username ?? null} />
    </main>
  );
}
