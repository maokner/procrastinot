/**
 * Service-role Supabase client. Server-only.
 *
 * Mirrors the indexer's pattern in `indexer/src/db.ts:82-87`: no session
 * persistence, no auto-refresh, with a tagged `X-Client-Info` header for
 * log tracing.
 *
 * This client bypasses RLS. Use it ONLY inside server routes that have
 * already authenticated the caller (or, in the SIWE verify case, after
 * verifying the signature). Never import from a client component.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './db-types.js';

export function supabaseAdmin(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'supabaseAdmin() requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'procrastinot-web-admin' } },
  });
}
