import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getPassedOracleVerdict } from '@/lib/oracle-verdicts';
import { supabaseServer } from '@/lib/supabase';
import { CONTRACT_ADDRESS } from '@/lib/contract';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let commitmentId: string;
  try {
    commitmentId = BigInt(id).toString();
  } catch {
    return NextResponse.json({ error: 'Invalid commitment id' }, { status: 400 });
  }

  const sb = supabaseServer(await cookies());
  const { data: commitment, error } = await sb
    .from('commitments')
    .select('id')
    .eq('id', Number(commitmentId))
    .eq('contract_address', CONTRACT_ADDRESS.toLowerCase())
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'Commitment lookup failed' }, { status: 500 });
  }
  if (!commitment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const verdict = await getPassedOracleVerdict(commitmentId);
  return NextResponse.json({ passed: Boolean(verdict), verdict });
}
