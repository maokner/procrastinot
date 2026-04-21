import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getProfile, hasCompletedOnboarding, requireSession } from '@/lib/auth';
import { OnboardingClient } from '@/components/auth/OnboardingClient';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const cookieJar = await cookies();
  const user = await requireSession(cookieJar, '/onboarding');
  const profile = await getProfile(cookieJar, user.id);

  if (hasCompletedOnboarding(profile)) redirect('/my');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
      <h1 className="mb-2 text-3xl font-semibold tracking-tight">Choose your username</h1>
      <p className="mb-8 text-sm text-neutral-400">
        Your wallet is already verified. Pick the public handle other players
        will see, then you&apos;ll land in your dashboard.
      </p>
      <OnboardingClient userId={user.id} initialUsername={profile?.username ?? null} />
    </main>
  );
}
