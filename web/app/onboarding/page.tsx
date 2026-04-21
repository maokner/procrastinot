import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getProfile, hasCompletedOnboarding, requireSession } from '@/lib/auth';
import { OnboardingClient } from '@/components/auth/OnboardingClient';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const cookieJar = await cookies();
  const user = await requireSession(cookieJar, '/onboarding');
  const profile = await getProfile(cookieJar, user.id);

  if (hasCompletedOnboarding(profile)) redirect('/my');

  return (
    <main className="pn-page max-w-2xl">
      <Link href="/login" className="pn-backlink mb-6">← Back to login</Link>
      <p className="pn-kicker mb-3">Profile Setup</p>
      <h1 className="pn-title mb-3 text-5xl">Choose your username</h1>
      <p className="pn-copy mb-8 max-w-xl text-base">
        Your wallet is already verified. Pick the public handle other players
        will see, then you&apos;ll land in your dashboard.
      </p>
      <section className="pn-panel rounded-2xl p-5">
        <OnboardingClient userId={user.id} initialUsername={profile?.username ?? null} />
      </section>
    </main>
  );
}
