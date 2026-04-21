'use client';

/**
 * Top-right user menu. Reads the Supabase session client-side, shows a
 * dropdown with profile / settings / sign out when logged in, or a single
 * wallet-login link when logged out.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase';

export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
    const supabase = supabaseBrowser();

    // Load initial session + subscribe to changes.
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      if (data.user) void loadUsername(data.user.id);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) void loadUsername(session.user.id);
      else setUsername(null);
    });

    async function loadUsername(uid: string) {
      const { data } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', uid)
        .maybeSingle();
      const row = data as { username: string | null } | null;
      setUsername(row?.username ?? null);
    }

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function signOut() {
    await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' });
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    setOpen(false);
    router.push('/');
    router.refresh();
  }

  // Avoid hydration mismatch: render the logged-out state skeleton until
  // we know the client-side session.
  if (!mounted) {
    return <div aria-hidden className="h-8 w-24" />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/login"
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-950 hover:bg-white"
        >
          Connect wallet
        </Link>
      </div>
    );
  }

  const label = username ? `@${username}` : user.email ?? 'account';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm hover:border-neutral-700"
      >
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-[10px] uppercase">
          {label.slice(username ? 1 : 0, (username ? 1 : 0) + 1) || '?'}
        </span>
        <span className="font-mono">{label}</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-10 mt-2 w-44 overflow-hidden rounded border border-neutral-800 bg-neutral-950 shadow-lg">
          {username ? (
            <Link
              href={`/profile/${username}`}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm hover:bg-neutral-900"
            >
              Profile
            </Link>
          ) : null}
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm hover:bg-neutral-900"
          >
            Settings
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="block w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-neutral-900"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
