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
    <header className="sticky top-0 z-40 border-b border-neutral-900 bg-neutral-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link
          href={authed ? '/my' : '/'}
          className="font-mono text-sm uppercase tracking-widest hover:text-neutral-300"
        >
          procrastinot
        </Link>

        {/* Desktop: inline identity + menu */}
        <div className="hidden md:flex md:items-center md:gap-4">
          {authed && profile ? (
            <>
              <span className="font-mono text-xs text-neutral-400">
                @{profile.username ?? 'unnamed'}
                {shortAddr ? (
                  <>
                    {' '}
                    <span className="text-neutral-600">•</span>{' '}
                    <span className="text-neutral-300">{shortAddr}</span>
                  </>
                ) : null}
              </span>
              <SessionMenu />
            </>
          ) : (
            <Link
              href="/login"
              className="rounded border border-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-900"
            >
              Connect wallet
            </Link>
          )}
        </div>

        {/* Mobile: <details> hamburger */}
        <details className="relative md:hidden">
          <summary
            aria-label="Open menu"
            className="list-none rounded border border-neutral-800 px-2 py-1.5 text-sm hover:bg-neutral-900 [&::-webkit-details-marker]:hidden"
          >
            <span aria-hidden>≡</span>
          </summary>
          <div className="absolute right-0 mt-2 w-56 rounded border border-neutral-800 bg-neutral-950 p-3 shadow-xl">
            {authed && profile ? (
              <div className="flex flex-col gap-3">
                <div className="font-mono text-xs text-neutral-400">
                  @{profile.username ?? 'unnamed'}
                  {shortAddr ? (
                    <div className="mt-0.5 text-neutral-300">{shortAddr}</div>
                  ) : null}
                </div>
                <SessionMenu variant="mobile" />
              </div>
            ) : (
              <Link
                href="/login"
                className="block rounded border border-neutral-800 px-3 py-1.5 text-center text-sm hover:bg-neutral-900"
              >
                Connect wallet
              </Link>
            )}
          </div>
        </details>
      </div>
    </header>
  );
}
