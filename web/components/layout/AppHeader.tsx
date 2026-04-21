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
    <header className="sticky top-0 z-40 border-b border-[var(--line)]/80 bg-[rgba(246,242,233,0.92)] backdrop-blur">
      <div className="mx-auto flex h-[var(--header-h)] w-full max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
        <Link href={authed ? '/my' : '/'} className="pn-title text-xl tracking-tight md:text-2xl">
          PROCRASTINOT
        </Link>

        <nav className="hidden items-center gap-2 md:flex">
          <HeaderLink href="/">Home</HeaderLink>
          <HeaderLink href="/create">Create</HeaderLink>
          <HeaderLink href="/my">My</HeaderLink>
          <HeaderLink href="/inbox">Inbox</HeaderLink>
        </nav>

        <div className="hidden md:flex md:items-center md:gap-3">
          {authed && profile ? (
            <>
              <span className="text-xs text-[var(--ink-2)]">
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
            className="pn-btn pn-btn-secondary list-none px-3 py-2 text-sm [&::-webkit-details-marker]:hidden"
          >
            Menu
          </summary>
          <div className="absolute right-0 mt-2 flex w-60 flex-col gap-2 rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,0.95)] p-3 shadow-lg">
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
                <div className="mb-2 text-xs text-[var(--ink-2)]">
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
          ? 'rounded-full px-3 py-2 text-sm text-[var(--ink-1)] hover:bg-[var(--accent-soft)] hover:text-[var(--ink-0)]'
          : 'rounded-full px-3 py-2 text-sm text-[var(--ink-1)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--ink-0)]'
      }
    >
      {children}
    </Link>
  );
}
