/**
 * POST /api/siwe/verify
 *
 * Body: { message: string, signature: string }
 *
 * - Requires an authenticated Supabase session.
 * - Verifies the SIWE signature against the nonce we issued for this user
 *   (single-use; popped from the in-process store).
 * - Enforces chainId === 11155111 (Sepolia).
 * - Uses the service-role Supabase client to upsert the verified wallet row
 *   (RLS blocks user-level writes by design).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { SiweMessage } from 'siwe';
import { supabaseServer, supabaseService } from '@/lib/supabase';
import { popNonce } from '../nonce/store';

export const runtime = 'nodejs';

const EXPECTED_CHAIN_ID = 11155111;

export async function POST(request: NextRequest) {
  let body: { message?: unknown; signature?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { message, signature } = body;
  if (typeof message !== 'string' || typeof signature !== 'string') {
    return NextResponse.json(
      { error: 'message and signature are required strings' },
      { status: 400 },
    );
  }

  const cookieJar = await cookies();
  const supabase = supabaseServer(cookieJar);
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userData.user.id;

  const expectedNonce = popNonce(userId);
  if (!expectedNonce) {
    return NextResponse.json(
      { error: 'no nonce issued or nonce expired — request a new one' },
      { status: 400 },
    );
  }

  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(message);
  } catch {
    return NextResponse.json({ error: 'malformed SIWE message' }, { status: 400 });
  }

  if (siwe.chainId !== EXPECTED_CHAIN_ID) {
    return NextResponse.json(
      { error: `expected chainId ${EXPECTED_CHAIN_ID}, got ${siwe.chainId}` },
      { status: 400 },
    );
  }

  // Verify signature + nonce + domain. We trust the Host header from the
  // proxy for domain matching; in production set a trusted proxy / use
  // NEXT_PUBLIC_SITE_URL.
  const domain = request.headers.get('host') ?? undefined;
  let ok = false;
  try {
    const result = await siwe.verify({ signature, nonce: expectedNonce, domain });
    ok = result.success;
  } catch {
    ok = false;
  }
  if (!ok) {
    return NextResponse.json({ error: 'signature verification failed' }, { status: 401 });
  }

  const address = siwe.address.toLowerCase();

  // Use the service-role client to upsert into `wallets`. RLS would otherwise
  // block the write — only verified SIWE flows (this route) may touch it.
  const svc = supabaseService();

  // Collision check: is this address already linked to a DIFFERENT profile?
  const { data: existing, error: selErr } = await svc
    .from('wallets')
    .select('profile_id')
    .eq('address', address)
    .eq('chain_id', EXPECTED_CHAIN_ID)
    .maybeSingle();
  if (selErr) {
    return NextResponse.json({ error: 'db error' }, { status: 500 });
  }
  const existingRow = existing as { profile_id: string } | null;
  if (existingRow && existingRow.profile_id !== userId) {
    return NextResponse.json(
      { error: 'wallet already linked to another account' },
      { status: 409 },
    );
  }

  // Upsert by profile_id (the unique constraint): re-verifying the same user
  // replaces their previous wallet row.
  const walletRow = {
    profile_id: userId,
    address,
    chain_id: EXPECTED_CHAIN_ID,
    verified_at: new Date().toISOString(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upsertErr } = await (svc.from('wallets') as any).upsert(
    walletRow,
    { onConflict: 'profile_id' },
  );
  if (upsertErr) {
    return NextResponse.json({ error: 'failed to save wallet' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
