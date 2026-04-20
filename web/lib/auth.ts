/**
 * Server-only auth helpers.
 *
 * These wrap `supabaseServer()` with the Next.js `cookies()` jar and give
 * Server Components + Route Handlers ergonomic session / profile checks.
 *
 * DO NOT import this from client components.
 */
import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { supabaseServer } from './supabase.js';
import type { Profile, Wallet } from './db-types.js';

/**
 * Shape compatible with the value returned by `cookies()` from `next/headers`.
 * We accept it as a parameter to stay compatible with both the sync and
 * awaited cookies() APIs across Next 15 minor versions.
 */
type CookieJar = Parameters<typeof supabaseServer>[0];

/** Returns the Supabase user or null. Never throws. */
export async function getSession(cookieJar: CookieJar): Promise<User | null> {
  const supabase = supabaseServer(cookieJar);
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

/** Returns the user's profile row or null. */
export async function getProfile(
  cookieJar: CookieJar,
  userId: string,
): Promise<Profile | null> {
  const supabase = supabaseServer(cookieJar);
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) return null;
  return data as Profile | null;
}

/** Returns the user's verified wallet row or null. */
export async function getWallet(
  cookieJar: CookieJar,
  userId: string,
): Promise<Wallet | null> {
  const supabase = supabaseServer(cookieJar);
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('profile_id', userId)
    .maybeSingle();
  if (error) return null;
  return data as Wallet | null;
}

/** Redirects to /login if no session; otherwise returns the user. */
export async function requireSession(
  cookieJar: CookieJar,
  next?: string,
): Promise<User> {
  const user = await getSession(cookieJar);
  if (!user) {
    const qs = next ? `?next=${encodeURIComponent(next)}` : '';
    redirect(`/login${qs}`);
  }
  return user;
}

/**
 * Redirects to /login if no session, to /onboarding if session but no profile.
 * Returns { user, profile } when both are present.
 */
export async function requireProfile(
  cookieJar: CookieJar,
  next?: string,
): Promise<{ user: User; profile: Profile }> {
  const user = await requireSession(cookieJar, next);
  const profile = await getProfile(cookieJar, user.id);
  if (!profile) redirect('/onboarding');
  return { user, profile };
}
