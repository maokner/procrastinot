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
          href="/settings"
          className="rounded border border-neutral-800 px-3 py-1.5 text-center text-sm hover:bg-neutral-900"
        >
          Settings
        </Link>
        <button
          type="button"
          onClick={handleDisconnect}
          disabled={busy}
          className="rounded border border-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-900 disabled:opacity-50"
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
        className="rounded border border-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-900"
      >
        Menu
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-40 rounded border border-neutral-800 bg-neutral-950 p-1 shadow-xl"
        >
          <Link
            href="/settings"
            role="menuitem"
            className="block rounded px-2 py-1.5 text-sm hover:bg-neutral-900"
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
            className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-900 disabled:opacity-50"
          >
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
