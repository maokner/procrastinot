import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase';

// TODO: add rate-limit (per-IP or per-user). Non-critical for demo.

const Q_RE = /^[a-z0-9_]{1,20}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  if (!Q_RE.test(q)) {
    return NextResponse.json(
      { error: 'q must match ^[a-z0-9_]{1,20}$' },
      { status: 400 },
    );
  }
  const sb = supabaseServer(await cookies());
  const { data, error } = await sb.rpc('search_usernames', {
    q,
    lim: 8,
  } as never);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}
