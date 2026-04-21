import Link from 'next/link';
import { cookies } from 'next/headers';
import { getWallet, requireProfile } from '@/lib/auth';
import { CopyButton } from '@/components/auth/CopyButton';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const cookieJar = await cookies();
  const { user, profile } = await requireProfile(cookieJar, '/settings');
  const wallet = await getWallet(cookieJar, user.id);

  return (
    <main className="pn-page max-w-4xl">
      <Link href="/my" className="pn-backlink mb-5">← Back to my commitments</Link>
      <h1 className="pn-title mb-8 text-5xl">Settings</h1>

      <section className="pn-panel flex flex-col gap-6 rounded-2xl p-6">
        <Row label="Username">
          <span className="font-mono">@{profile.username ?? 'pending'}</span>
        </Row>

        <Row label="Email">
          <span className="font-mono text-sm text-[var(--ink-2)]">{user.email}</span>
        </Row>

        <Row label="Linked wallet">
          {wallet ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-[var(--ink-1)]">{wallet.address}</span>
              <CopyButton value={wallet.address} />
            </div>
          ) : (
            <Link href="/onboarding" className="text-sm underline">
              Link a wallet
            </Link>
          )}
        </Row>

        {/* Future: "change wallet" flow. For now, one wallet per profile. */}

        {/* Sign-out lives in the global AppHeader's SessionMenu now. */}
      </section>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--line)] pb-4">
      <span className="text-xs uppercase tracking-wider text-[var(--ink-2)]">{label}</span>
      <div>{children}</div>
    </div>
  );
}
