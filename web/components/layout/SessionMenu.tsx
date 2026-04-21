'use client';

/**
 * Client-side session dropdown.
 *
 * Wagmi's disconnect must run client-side. The server signout clears the
 * Supabase cookies; wagmi disconnect drops the provider so the next SIWE
 * starts from a clean slate.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useDisconnect } from 'wagmi';

type Variant = 'desktop' | 'mobile';

export function SessionMenu({ variant = 'desktop' }: { variant?: Variant }) {
  const router = useRouter();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleDisconnect() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' });
    } catch {
      // Swallow — we still want to drop the wallet connector and leave.
    }
    try {
      disconnect();
    } catch {
      /* noop */
    }
    router.push('/login');
    router.refresh();
  }

  if (variant === 'mobile') {
    return (
      <div className="flex flex-col gap-2">
        <Link
          href="/my"
          className="pn-btn pn-btn-secondary w-full text-sm"
        >
          My commitments
        </Link>
        <Link
          href="/settings"
          className="pn-btn pn-btn-secondary w-full text-sm"
        >
          Settings
        </Link>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={busy}
          className="pn-btn pn-btn-danger w-full text-sm"
        >
          {busy ? 'Disconnecting…' : 'Disconnect'}
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={(e) => {
          // Close if focus leaves the whole menu container.
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
            setOpen(false);
          }
        }}
        className="pn-btn pn-btn-secondary px-3 py-2 text-sm"
      >
        Account
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-48 rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,0.96)] p-2 shadow-lg"
        >
          <Link
            href="/my"
            role="menuitem"
            className="block rounded-xl px-3 py-2 text-sm hover:bg-[var(--accent-soft)]"
            onClick={() => setOpen(false)}
          >
            My commitments
          </Link>
          <Link
          href="/settings"
          role="menuitem"
          className="block rounded-xl px-3 py-2 text-sm hover:bg-[var(--accent-soft)]"
          onClick={() => setOpen(false)}
        >
          Settings
        </Link>
          <button
            type="button"
            role="menuitem"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleDisconnect}
            disabled={busy}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
          >
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
