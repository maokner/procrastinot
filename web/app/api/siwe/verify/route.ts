/**
 * POST /api/siwe/verify
 *
 * Body: { message: string, signature: string }
 *
 * Wallet-first sign-in entry point.
 *
 * - Verifies the SIWE signature pre-auth against the nonce we issued for the
 *   connected wallet address.
 * - Finds or creates the matching auth user + public profile + wallet row.
 * - Mints a real Supabase session via admin.generateLink(...magiclink) and
 *   auth.verifyOtp({ token_hash, type: 'magiclink' }), so the browser gets
 *   both access + refresh tokens in the standard SSR auth cookies.
 * - Returns { needsUsername } so the client can route to /onboarding or /my.
 */
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SiweMessage } from 'siwe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { siteHost } from '@/lib/env';
import { popNonce } from '../nonce/store';

export const runtime = 'nodejs';

const EXPECTED_CHAIN_ID = 11155111;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type WalletLookup = { profile_id: string };
type ProfileUsernameRow = { username: string | null };

function walletEmail(address: string): string {
  return `${address.toLowerCase()}@wallet.procrastinot.local`;
}

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

  const address = siwe.address.toLowerCase();
  const expectedNonce = popNonce(address);
  if (!expectedNonce) {
    return NextResponse.json(
      { error: 'no nonce issued or nonce expired — request a new one' },
      { status: 400 },
    );
  }

  const domain = siteHost() ?? request.headers.get('host') ?? undefined;
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

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return NextResponse.json({ error: 'supabase env missing' }, { status: 500 });
  }

  const admin = supabaseAdmin();
  const { data: existingWalletRaw, error: walletErr } = await admin
    .from('wallets')
    .select('profile_id')
    .eq('address', address)
    .eq('chain_id', EXPECTED_CHAIN_ID)
    .maybeSingle();
  if (walletErr) {
    return NextResponse.json({ error: 'db error' }, { status: 500 });
  }
  const existingWallet = existingWalletRaw as WalletLookup | null;

  let userId: string;
  let email: string;
  let needsUsername = true;

  if (existingWallet?.profile_id) {
    userId = existingWallet.profile_id;

    const [{ data: authUserData, error: authUserErr }, { data: profile, error: profileErr }] =
      await Promise.all([
        admin.auth.admin.getUserById(userId),
        admin.from('profiles').select('username').eq('id', userId).maybeSingle(),
      ]);

    if (authUserErr || !authUserData.user?.email) {
      return NextResponse.json({ error: 'failed to load wallet user' }, { status: 500 });
    }
    if (profileErr) {
      return NextResponse.json({ error: 'failed to load profile' }, { status: 500 });
    }

    email = authUserData.user.email;
    needsUsername = !(profile as ProfileUsernameRow | null)?.username;
  } else {
    email = walletEmail(address);

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        data: {
          wallet_address: address,
          auth_method: 'siwe',
        },
      },
    });
    if (linkErr || !linkData.user || !linkData.properties?.hashed_token) {
      return NextResponse.json({ error: 'failed to provision wallet user' }, { status: 500 });
    }

    userId = linkData.user.id;

    // Ensure the public app tables exist before the session is returned.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: profileErr } = await (admin.from('profiles') as any).upsert(
      {
        id: userId,
        username: null,
        display_name: null,
        avatar_url: null,
      },
      { onConflict: 'id' },
    );
    if (profileErr) {
      return NextResponse.json({ error: 'failed to save profile' }, { status: 500 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: walletInsertErr } = await (admin.from('wallets') as any).insert({
      profile_id: userId,
      address,
      chain_id: EXPECTED_CHAIN_ID,
      verified_at: new Date().toISOString(),
    });
    if (walletInsertErr) {
      return NextResponse.json({ error: 'failed to save wallet' }, { status: 500 });
    }

    const response = NextResponse.json({ needsUsername: true });
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    });
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: 'magiclink',
    });
    if (verifyErr) {
      return NextResponse.json({ error: 'failed to mint session' }, { status: 500 });
    }

    return response;
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !linkData.properties?.hashed_token) {
    return NextResponse.json({ error: 'failed to generate login link' }, { status: 500 });
  }

  const response = NextResponse.json({ needsUsername });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyErr) {
    return NextResponse.json({ error: 'failed to mint session' }, { status: 500 });
  }

  return response;
}
