'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';
import { UsernameInput, type UsernameStatus } from './UsernameInput';

export function OnboardingClient({
  userId,
  initialUsername,
}: {
  userId: string;
  initialUsername: string | null;
}) {
  const router = useRouter();
  const [username, setUsername] = useState(initialUsername ?? '');
  const [status, setStatus] = useState<UsernameStatus>('empty');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function saveUsername(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (status !== 'available') {
      setErr('Pick an available username first.');
      return;
    }
    setSubmitting(true);
    try {
      const supabase = supabaseBrowser();
      const row = {
        id: userId,
        username,
        display_name: null,
        avatar_url: null,
      };
      // Wallet-first sign-in should already have created the row, but upsert
      // keeps onboarding resilient if a prior attempt only partially landed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('profiles') as any).upsert(row, {
        onConflict: 'id',
      });
      if (error) {
        setErr(error.message);
        return;
      }
      router.push('/my');
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={saveUsername} className="flex flex-col gap-4">
      <UsernameInput
        value={username}
        onChange={setUsername}
        onStatusChange={setStatus}
      />
      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      <button
        type="submit"
        disabled={submitting || status !== 'available'}
        className="w-fit rounded bg-neutral-100 px-4 py-2 font-medium text-neutral-950 hover:bg-white disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Continue to my commitments'}
      </button>
    </form>
  );
}
