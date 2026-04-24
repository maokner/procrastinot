import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SupabaseAdminClient = SupabaseClient;

export function createSupabaseAdminClient(args: {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
}): SupabaseAdminClient {
  return createClient(args.supabaseUrl, args.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'procrastinot-oracle-admin' } },
  });
}
