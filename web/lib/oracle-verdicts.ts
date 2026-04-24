import { supabaseAdmin } from './supabase-admin';
import { CONTRACT_ADDRESS } from './contract';

export type PassedOracleVerdict = {
  attemptNumber: number;
  reason: string | null;
  txHash: string | null;
  updatedAt: string;
};

export async function getPassedOracleVerdict(
  commitmentId: string | number,
): Promise<PassedOracleVerdict | null> {
  const admin = supabaseAdmin();
  const verdicts = admin.from('oracle_verdicts') as any;
  const { data, error } = await verdicts
    .select('attempt_number, reason, tx_hash, updated_at')
    .eq('contract_address', CONTRACT_ADDRESS.toLowerCase())
    .eq('commitment_id', String(commitmentId))
    .eq('status', 'submitted')
    .eq('passed', true)
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    attemptNumber: Number(data.attempt_number),
    reason: data.reason ?? null,
    txHash: data.tx_hash ?? null,
    updatedAt: data.updated_at,
  };
}
