'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase';

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsVerify, setNeedsVerify] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setErr('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setErr(error.message);
        return;
      }
      if (data.user && data.user.confirmed_at == null && !data.session) {
        // Email confirmation is required by Supabase settings.
        setNeedsVerify(true);
        return;
      }
      router.push('/onboarding');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected error');
    } finally {
      setSubmitting(false);
    }
  }

  if (needsVerify) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-950 p-6">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="text-sm text-neutral-400">
          We sent a confirmation link to <span className="font-mono">{email}</span>.
          Click it and then <Link href="/login" className="underline">sign in</Link>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm text-neutral-400">Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 outline-none focus:border-neutral-600"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-neutral-400">Password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 outline-none focus:border-neutral-600"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-neutral-400">Confirm password</span>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 outline-none focus:border-neutral-600"
        />
      </label>
      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-neutral-100 px-4 py-2 font-medium text-neutral-950 hover:bg-white disabled:opacity-50"
      >
        {submitting ? 'Creating account…' : 'Sign up'}
      </button>
      <p className="text-xs text-neutral-500">
        Already have an account?{' '}
        <Link href="/login" className="underline">
          Log in
        </Link>
        .
      </p>
    </form>
  );
}
