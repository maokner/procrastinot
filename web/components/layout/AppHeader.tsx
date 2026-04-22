/**
 * Global top-bar. Server component.
 *
 * Reads the current session (if any), resolves the user's profile + wallet,
 * and renders either:
 *   • `@username • 0xABCD…1234` + <SessionMenu /> when authed
 *   • a "Connect wallet" CTA linking to /login when not
 *
 * Collapses to a hamburger at < md via <details> + Tailwind.
 */
import Link from 'next/link';
import { cookies } from 'next/headers';
import { getSession, getProfile, getWallet } from '@/lib/auth';
import { SessionMenu } from './SessionMenu';

export async function AppHeader() {
  const cookieJar = await cookies();
  const user = await getSession(cookieJar);
  const profile = user ? await getProfile(cookieJar, user.id) : null;
  const wallet = user ? await getWallet(cookieJar, user.id) : null;

  const authed = Boolean(user && profile);
  const shortAddr = wallet?.address
    ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
    : null;

  return (
    <header className="sticky top-0 z-40 border-b-4 border-black bg-[rgba(249,249,247,0.97)]">
      <div className="mx-auto flex h-[var(--header-h)] w-[var(--container)] items-center justify-between gap-4">
        <Link href={authed ? '/my' : '/'} className="pn-title text-2xl uppercase md:text-4xl">
          Procrastinot
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          <HeaderLink href="/">Home</HeaderLink>
          <HeaderLink href="/create">Create</HeaderLink>
          <HeaderLink href="/my">My</HeaderLink>
          <HeaderLink href="/inbox">Inbox</HeaderLink>
        </nav>

        <div className="hidden md:flex md:items-center md:gap-4">
          {authed && profile ? (
            <>
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-2)]">
                @{profile.username ?? 'unnamed'}
                {shortAddr ? <span className="ml-2 font-mono">{shortAddr}</span> : null}
              </span>
              <SessionMenu />
            </>
          ) : (
            <Link href="/login" className="pn-btn pn-btn-secondary text-sm">
              Connect Wallet
            </Link>
          )}
        </div>

        <details className="relative md:hidden">
          <summary
            aria-label="Open menu"
            className="pn-btn pn-btn-secondary list-none px-3 py-2 [&::-webkit-details-marker]:hidden"
          >
            Menu
          </summary>
          <div className="absolute right-0 mt-2 flex w-64 flex-col gap-2 border-2 border-black bg-white p-3">
            <HeaderLink href="/" mobile>
              Home
            </HeaderLink>
            <HeaderLink href="/create" mobile>
              Create
            </HeaderLink>
            <HeaderLink href="/my" mobile>
              My
            </HeaderLink>
            <HeaderLink href="/inbox" mobile>
              Inbox
            </HeaderLink>
            {authed && profile ? (
              <div className="pt-2">
                <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-2)]">
                  @{profile.username ?? 'unnamed'}
                  {shortAddr ? <span className="ml-2 font-mono">{shortAddr}</span> : null}
                </div>
                <SessionMenu variant="mobile" />
              </div>
            ) : (
              <Link href="/login" className="pn-btn pn-btn-primary text-sm">
                Connect Wallet
              </Link>
            )}
          </div>
        </details>
      </div>
    </header>
  );
}

function HeaderLink({
  href,
  children,
  mobile = false,
}: {
  href: string;
  children: React.ReactNode;
  mobile?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        mobile
          ? 'border-b border-[var(--line)] px-0 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-1)] hover:text-[var(--ink-0)]'
          : 'border-b border-transparent pb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-1)] transition hover:border-black hover:text-[var(--ink-0)]'
      }
    >
      {children}
    </Link>
  );
}
