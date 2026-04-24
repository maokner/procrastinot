import { cookies } from 'next/headers';
import { supabaseServer } from './supabase.js';
import { supabaseAdmin } from './supabase-admin.js';
import { CONTRACT_ADDRESS } from './contract.js';
import type { Commitment, Profile, VerdictEvent } from './db-types.js';

export type CommitmentWithProfiles = Commitment & {
  creator?: Pick<Profile, 'username' | 'display_name' | 'avatar_url'> | null;
  enemy?: Pick<Profile, 'username' | 'display_name' | 'avatar_url'> | null;
};

/**
 * Get the currently signed-in Supabase user's profile id, if any.
 * Returns null for anonymous visitors.
 */
export async function getViewerProfile(): Promise<Profile | null> {
  const sb = supabaseServer(await cookies());
  const { data: userResp } = await sb.auth.getUser();
  if (!userResp?.user) return null;
  const { data } = await sb
    .from('profiles')
    .select('*')
    .eq('id', userResp.user.id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

/** List commitments where the viewer is creator or enemy. */
export async function listMyCommitments(profileId: string, limit = 50) {
  const sb = supabaseServer(await cookies());
  const { data, error } = await sb
    .from('commitments')
    .select('*')
    .eq('contract_address', CONTRACT_ADDRESS.toLowerCase())
    .or(`creator_profile.eq.${profileId},enemy_profile.eq.${profileId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Commitment[];
}

/** List active commitments where the viewer is the enemy. */
export async function listInboxActive(profileId: string) {
  const sb = supabaseServer(await cookies());
  const { data, error } = await sb
    .from('commitments')
    .select('*')
    .eq('contract_address', CONTRACT_ADDRESS.toLowerCase())
    .eq('enemy_profile', profileId)
    .eq('status', 'active')
    .order('deadline', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Commitment[];
}

/** History view for inbox: completed / forfeited commitments where viewer is enemy. */
export async function listInboxHistory(profileId: string, limit = 50) {
  const sb = supabaseServer(await cookies());
  const { data, error } = await sb
    .from('commitments')
    .select('*')
    .eq('contract_address', CONTRACT_ADDRESS.toLowerCase())
    .eq('enemy_profile', profileId)
    .neq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Commitment[];
}

/** Fetch one commitment by id. Returns null if not visible (RLS) or not yet indexed. */
export async function getCommitment(id: string | number): Promise<Commitment | null> {
  const sb = supabaseServer(await cookies());
  const { data } = await sb
    .from('commitments')
    .select('*')
    .eq('id', Number(id))
    .eq('contract_address', CONTRACT_ADDRESS.toLowerCase())
    .maybeSingle();
  return (data as Commitment | null) ?? null;
}

/** Fetch verdict events for a commitment in chronological order. */
export async function listVerdictEvents(commitmentId: number): Promise<VerdictEvent[]> {
  const sb = supabaseServer(await cookies());
  const { data, error } = await sb
    .from('verdict_events')
    .select('*')
    .eq('commitment_id', commitmentId)
    .eq('commitment_contract_address', CONTRACT_ADDRESS.toLowerCase())
    .order('block_number', { ascending: true });
  if (error) throw error;
  return (data ?? []) as VerdictEvent[];
}

/** Aggregate stats for a user's commitments as creator (public profile view). */
export async function getProfileStats(profileId: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('commitments')
    .select('status, stake')
    .eq('contract_address', CONTRACT_ADDRESS.toLowerCase())
    .eq('creator_profile', profileId);
  if (error) throw error;
  const rows = (data ?? []) as Pick<Commitment, 'status' | 'stake'>[];
  const total = rows.length;
  const completed = rows.filter(c => c.status === 'completed').length;
  const passRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const totalStaked = rows.reduce((sum, c) => sum + parseFloat(c.stake), 0);
  const totalForfeited = rows
    .filter(c => c.status === 'forfeited')
    .reduce((sum, c) => sum + parseFloat(c.stake), 0);
  return { total, passRate, totalStaked, totalForfeited };
}

/** Fetch up to 50 of a user's commitments as creator, newest-first (bypasses RLS). */
export async function listPublicCommitments(profileId: string, limit = 50) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('commitments')
    .select('*')
    .eq('contract_address', CONTRACT_ADDRESS.toLowerCase())
    .eq('creator_profile', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Commitment[];
}

/** Count times named as enemy and total USDC claimed from forfeited commitments. */
export async function getEnemyStats(profileId: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('commitments')
    .select('status, stake')
    .eq('contract_address', CONTRACT_ADDRESS.toLowerCase())
    .eq('enemy_profile', profileId);
  if (error) throw error;
  const rows = (data ?? []) as Pick<Commitment, 'status' | 'stake'>[];
  const timesNamed = rows.length;
  const totalClaimed = rows
    .filter(c => c.status === 'forfeited')
    .reduce((sum, c) => sum + parseFloat(c.stake), 0);
  return { timesNamed, totalClaimed };
}

/** Batch-look-up profiles by id (for rendering usernames on list views). */
export async function profilesByIds(ids: (string | null | undefined)[]) {
  const unique = Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
  if (unique.length === 0) return new Map<string, Profile>();
  const sb = supabaseServer(await cookies());
  const { data, error } = await sb
    .from('profiles')
    .select('id, username, display_name, avatar_url, created_at')
    .in('id', unique);
  if (error) throw error;
  const map = new Map<string, Profile>();
  for (const p of (data ?? []) as Profile[]) map.set(p.id, p);
  return map;
}
