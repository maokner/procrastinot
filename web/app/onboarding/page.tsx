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
      <div className="mb-8 border-b-4 border-black pb-6">
        <p className="pn-kicker mb-3">Profile setup</p>
        <h1 className="pn-title mb-3 text-5xl sm:text-6xl">Choose your username</h1>
        <p className="pn-copy max-w-xl text-base">
          Your wallet is already verified. Pick the public handle other people will
          see, then continue into the workspace.
        </p>
      </div>
      <section className="pn-panel p-5 md:p-6">
        <OnboardingClient userId={user.id} initialUsername={profile?.username ?? null} />
      </section>
    </main>
  );
}
