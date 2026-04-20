/**
 * GET /api/siwe/nonce
 *
 * Requires an authenticated Supabase session. Issues a fresh nonce bound to
 * the user's id with a 5-minute TTL and returns it to the client.
 *
 * NOTE: The nonce store is in-process (see `./store`). It works only for a
 * single Node.js process. Before deploying behind more than one replica,
 * replace the Map with Redis or a Postgres table.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { generateNonce } from 'siwe';
import { supabaseServer } from '@/lib/supabase';
import { putNonce } from './store';

export const runtime = 'nodejs';

export async function GET() {
  const cookieJar = await cookies();
  const supabase = supabaseServer(cookieJar);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const nonce = generateNonce();
  putNonce(data.user.id, nonce);
  return NextResponse.json({ nonce });
}
