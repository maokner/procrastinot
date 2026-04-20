import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { getSession, getProfile } from '@/lib/auth';
import { LoginForm } from '@/components/auth/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const cookieJar = await cookies();
  const user = await getSession(cookieJar);
  if (user) {
    const profile = await getProfile(cookieJar, user.id);
    redirect(profile ? '/my' : '/onboarding');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="font-mono text-sm uppercase tracking-widest">
          procrastinot
        </Link>
      </header>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Log in</h1>
      {/* useSearchParams requires a Suspense boundary during streaming. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
