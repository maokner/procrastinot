'use client';

/**
 * Two-step onboarding:
 *   1. Pick a username (insert into `profiles`).
 *   2. Link a wallet via SIWE.
 *
 * The server component that wraps this passes in whether the user already
 * has a profile / wallet so we can skip finished steps on refresh.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';
import { UsernameInput, type UsernameStatus } from './UsernameInput';
import { SiweButton } from './SiweButton';

export function OnboardingClient({
  userId,
  initialUsername,
}: {
  userId: string;
  initialUsername: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<'username' | 'wallet'>(
    initialUsername ? 'wallet' : 'username',
  );
  const [username, setUsername] = useState('');
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('profiles') as any).insert(row);
      if (error) {
        setErr(error.message);
        return;
      }
      setStep('wallet');
    } finally {
      setSubmitting(false);
    }
  }

  function onWalletLinked() {
    router.push('/my');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <Stepper step={step} />

      {step === 'username' ? (
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
            {submitting ? 'Saving…' : 'Continue'}
          </button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-semibold">Link your wallet</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Procrastinot uses SIWE (Sign-In with Ethereum) to prove you own
              the wallet you&apos;ll stake from. You only do this once.
            </p>
          </div>
          <SiweButton onSuccess={onWalletLinked} />
        </div>
      )}
    </div>
  );
}

function Stepper({ step }: { step: 'username' | 'wallet' }) {
  return (
    <ol className="flex items-center gap-2 text-xs text-neutral-500">
      <li className={step === 'username' ? 'text-neutral-100' : 'text-emerald-400'}>
        1. Pick a username
      </li>
      <span>→</span>
      <li className={step === 'wallet' ? 'text-neutral-100' : ''}>
        2. Link your wallet
      </li>
    </ol>
  );
}
