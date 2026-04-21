import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { getSession, getProfile, hasCompletedOnboarding } from '@/lib/auth';
import { SiweButton } from '@/components/auth/SiweButton';

export const dynamic = 'force-dynamic';

function safeNextPath(raw: string | string[] | undefined): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) {
    return null;
  }
  return raw;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string | string[] }>;
}) {
  const cookieJar = await cookies();
  const next = safeNextPath((await searchParams)?.next);
  const user = await getSession(cookieJar);
  if (user) {
    const profile = await getProfile(cookieJar, user.id);
    redirect(hasCompletedOnboarding(profile) ? next ?? '/my' : '/onboarding');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">Connect your wallet</h1>
      <p className="mb-8 text-sm text-neutral-400">
        Procrastinot is passwordless now. Connect the wallet you&apos;ll stake from,
        sign the SIWE message, and we&apos;ll either send you to onboarding or straight
        into the app.
      </p>
      <Suspense fallback={null}>
        <SiweButton nextPath={next} />
      </Suspense>
    </main>
  );
}
