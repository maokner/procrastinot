'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handle() {
    setBusy(true);
    try {
      await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' });
      await supabaseBrowser().auth.signOut();
    } finally {
      router.push('/');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      className="w-fit rounded border border-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-900 disabled:opacity-50"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
