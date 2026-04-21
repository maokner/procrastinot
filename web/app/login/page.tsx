import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { Suspense } from 'react';
import Link from 'next/link';
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
    <main className="pn-page max-w-2xl">
      <Link href="/" className="pn-backlink mb-6">← Back to home</Link>
      <p className="pn-kicker mb-3">Access</p>
      <h1 className="pn-title mb-3 text-5xl">Connect your wallet</h1>
      <p className="pn-copy mb-8 max-w-xl text-base">
        Procrastinot is passwordless now. Connect the wallet you&apos;ll stake from,
        sign the SIWE message, and we&apos;ll either send you to onboarding or straight
        into the app.
      </p>
      <section className="pn-panel rounded-2xl p-5">
        <Suspense fallback={null}>
          <SiweButton nextPath={next} />
        </Suspense>
      </section>
    </main>
  );
}
