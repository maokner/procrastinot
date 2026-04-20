import Link from 'next/link';
import { cookies } from 'next/headers';
import { getWallet, requireProfile } from '@/lib/auth';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { CopyButton } from '@/components/auth/CopyButton';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const cookieJar = await cookies();
  const { user, profile } = await requireProfile(cookieJar, '/settings');
  const wallet = await getWallet(cookieJar, user.id);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="font-mono text-sm uppercase tracking-widest">
          procrastinot
        </Link>
      </header>

      <h1 className="mb-8 text-3xl font-semibold tracking-tight">Settings</h1>

      <section className="flex flex-col gap-6">
        <Row label="Username">
          <span className="font-mono">@{profile.username}</span>
        </Row>

        <Row label="Email">
          <span className="font-mono text-sm text-neutral-400">{user.email}</span>
        </Row>

        <Row label="Linked wallet">
          {wallet ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-neutral-300">{wallet.address}</span>
              <CopyButton value={wallet.address} />
            </div>
          ) : (
            <Link href="/onboarding" className="text-sm underline">
              Link a wallet
            </Link>
          )}
        </Row>

        {/* Future: "change wallet" flow. For now, one wallet per profile. */}

        <div className="mt-6">
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-neutral-900 pb-4">
      <span className="text-xs uppercase tracking-wider text-neutral-500">{label}</span>
      <div>{children}</div>
    </div>
  );
}
