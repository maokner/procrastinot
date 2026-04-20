/**
 * POST /api/auth/signout
 *
 * Clears the Supabase session cookies for the caller.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST() {
  const cookieJar = await cookies();
  const supabase = supabaseServer(cookieJar);
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
