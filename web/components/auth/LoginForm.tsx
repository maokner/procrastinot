'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase';

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setErr(error.message);
        return;
      }
      if (!data.user) {
        setErr('Sign in failed.');
        return;
      }

      // Does this user already have a profile?
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', data.user.id)
        .maybeSingle();

      const destination = profile ? (next && next.startsWith('/') ? next : '/my') : '/onboarding';
      router.push(destination);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'unexpected error');
    } finally {
      setSubmitting(false);
    }
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2 outline-none focus:border-neutral-600"
        />
      </label>
      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-neutral-100 px-4 py-2 font-medium text-neutral-950 hover:bg-white disabled:opacity-50"
      >
        {submitting ? 'Signing in…' : 'Log in'}
      </button>
      <p className="text-xs text-neutral-500">
        No account?{' '}
        <Link href="/signup" className="underline">
          Sign up
        </Link>
        .
      </p>
    </form>
  );
}
