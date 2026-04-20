import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { SignupForm } from '@/components/auth/SignupForm';

export const dynamic = 'force-dynamic';

export default async function SignupPage() {
  const cookieJar = await cookies();
  const user = await getSession(cookieJar);
  if (user) redirect('/onboarding');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="font-mono text-sm uppercase tracking-widest">
          procrastinot
        </Link>
      </header>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Create an account</h1>
      <SignupForm />
    </main>
  );
}
