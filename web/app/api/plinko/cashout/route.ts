import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getWallet, requireProfile } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { parseUsdcToUnits } from '@/lib/plinko';

export const runtime = 'nodejs';

const ORACLE_API_URL = process.env.ORACLE_API_URL;

export async function POST(request: NextRequest) {
  if (!ORACLE_API_URL) {
    return NextResponse.json({ error: 'Oracle not configured' }, { status: 503 });
  }

  const cookieJar = await cookies();
  const { profile } = await requireProfile(cookieJar, '/degen');
  const wallet = await getWallet(cookieJar, profile.id);
  if (!wallet) {
    return NextResponse.json({ error: 'No wallet linked' }, { status: 400 });
  }

  let body: { amount?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const admin = supabaseAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const balances = admin.from('degen_balances') as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessions = admin.from('degen_sessions') as any;
  const { data: balRow, error: balErr } = await balances
    .select('balance_usdc')
    .eq('user_id', profile.id)
    .maybeSingle();

  if (balErr) {
    return NextResponse.json({ error: 'Balance lookup failed' }, { status: 500 });
  }
  if (!balRow || balRow.balance_usdc <= 0) {
    return NextResponse.json({ error: 'Nothing to cash out' }, { status: 400 });
  }

  const requestedAmount =
    body.amount === undefined || body.amount === ''
      ? BigInt(balRow.balance_usdc)
      : parseUsdcToUnits(body.amount);
  if (requestedAmount === null || requestedAmount <= 0n) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
  }
  if (requestedAmount > BigInt(balRow.balance_usdc)) {
    return NextResponse.json({ error: 'Amount exceeds balance' }, { status: 400 });
  }

  const newBalance = balRow.balance_usdc - Number(requestedAmount);
  const { data: updatedRows, error: updateErr } = await balances
    .update({ balance_usdc: newBalance, updated_at: new Date().toISOString() })
    .eq('user_id', profile.id)
    .eq('balance_usdc', balRow.balance_usdc)
    .select('user_id');

  if (updateErr) {
    return NextResponse.json({ error: 'Cashout failed' }, { status: 500 });
  }
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json({ error: 'Concurrent update detected, retry' }, { status: 409 });
  }

  let oracleRes: Response;
  try {
    oracleRes = await fetch(`${ORACLE_API_URL}/api/vault-release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet.address,
        amount: requestedAmount.toString(),
      }),
    });
  } catch {
    oracleRes = new Response(null, { status: 502 });
  }

  if (!oracleRes.ok) {
    await balances
      .update({ balance_usdc: balRow.balance_usdc, updated_at: new Date().toISOString() })
      .eq('user_id', profile.id);
    return NextResponse.json({ error: 'Oracle release failed' }, { status: 502 });
  }

  const oracleData = (await oracleRes.json()) as { txHash?: string };
  await sessions
    .update({
      cashed_out_usdc: Number(requestedAmount),
      cashout_tx_hash: oracleData.txHash ?? null,
      cashed_out_at: new Date().toISOString(),
    })
    .eq('user_id', profile.id)
    .is('cashed_out_at', null);

  return NextResponse.json({ success: true, txHash: oracleData.txHash });
}
