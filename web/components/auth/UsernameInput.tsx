'use client';

/**
 * Controlled input for picking a username during onboarding.
 * - Validates client-side against ^[a-z0-9_]{3,20}$.
 * - Debounces (300ms) a uniqueness check against the `profiles` table.
 * - Reports status through `onStatusChange` so the parent form can enable /
 *   disable its submit button.
 */

import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';

export type UsernameStatus =
  | 'empty'
  | 'invalid'
  | 'checking'
  | 'taken'
  | 'available'
  | 'error';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function UsernameInput({
  value,
  onChange,
  onStatusChange,
}: {
  value: string;
  onChange: (next: string) => void;
  onStatusChange?: (status: UsernameStatus) => void;
}) {
  const [status, setStatus] = useState<UsernameStatus>('empty');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value) {
      setStatus('empty');
      return;
    }
    if (!USERNAME_RE.test(value)) {
      setStatus('invalid');
      return;
    }

    setStatus('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const supabase = supabaseBrowser();
        const { data, error } = await supabase
          .from('profiles')
          .select('id')
          .eq('username', value)
          .maybeSingle();
        if (error) {
          setStatus('error');
          return;
        }
        setStatus(data ? 'taken' : 'available');
      } catch {
        setStatus('error');
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  const message = statusMessage(status);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="username" className="text-sm text-neutral-400">
        Pick a username
      </label>
      <div className="flex items-center rounded border border-neutral-800 bg-neutral-950 focus-within:border-neutral-600">
        <span className="pl-3 text-neutral-500">@</span>
        <input
          id="username"
          name="username"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          placeholder="your_handle"
          className="w-full bg-transparent px-2 py-2 text-neutral-100 outline-none"
        />
      </div>
      {message ? (
        <p
          className={`text-xs ${
            status === 'available' ? 'text-emerald-400' : 'text-neutral-500'
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

function statusMessage(s: UsernameStatus): string {
  switch (s) {
    case 'empty':
      return '3–20 characters, lowercase letters, digits, underscores.';
    case 'invalid':
      return 'Only a–z, 0–9, _ (3–20 chars).';
    case 'checking':
      return 'Checking availability…';
    case 'taken':
      return 'Taken. Try another.';
    case 'available':
      return 'Available.';
    case 'error':
      return "Couldn't check availability. Try again.";
  }
}
