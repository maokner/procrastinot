import { createBrowserClient, createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './db-types.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function requirePublicEnv() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase env missing: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. See web/.env.example.',
    );
  }
  return { url: SUPABASE_URL, anon: SUPABASE_ANON_KEY };
}

/**
 * Client-side Supabase (RLS-enforced). Use inside 'use client' components.
 * Reads the auth session from cookies set by our middleware.
 */
export function supabaseBrowser(): SupabaseClient<Database> {
  const { url, anon } = requirePublicEnv();
  return createBrowserClient<Database>(url, anon);
}

/**
 * Server-side Supabase (RLS-enforced). Use inside Server Components, Route
 * Handlers, and Server Actions. Takes the cookies() helper from next/headers
 * so it can read/refresh the user's session cookie.
 */
export function supabaseServer(cookieJar: CookieJar): SupabaseClient<Database> {
  const { url, anon } = requirePublicEnv();
  return createServerClient<Database>(url, anon, {
    cookies: {
      get(name: string) {
        return cookieJar.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieJar.set?.({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieJar.set?.({ name, value: '', ...options });
      },
    },
  });
}

/**
 * Service-role Supabase client — bypasses RLS. SERVER-ONLY.
 * Reads SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix; never shipped to browser).
 * Use inside server routes for privileged ops (SIWE verify, admin tasks). Do
 * not import this from client components — the env var will be undefined there
 * and it would throw, but treat the import itself as a server-only contract.
 */
export function supabaseService(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'supabaseService() requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Shape compatible with `cookies()` from next/headers. */
type CookieJar = {
  get(name: string): { value: string } | undefined;
  set?: (opts: { name: string; value: string } & CookieOptions) => void;
};
