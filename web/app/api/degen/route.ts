import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getWallet, requireProfile } from '@/lib/auth';

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

  let body: { commitmentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.commitmentId !== 'string' || body.commitmentId.length === 0) {
    return NextResponse.json({ error: 'commitmentId is required' }, { status: 400 });
  }

  let oracleRes: Response;
  try {
    oracleRes = await fetch(`${ORACLE_API_URL}/api/degen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commitmentId: body.commitmentId,
        profileId: profile.id,
        walletAddress: wallet.address,
      }),
    });
  } catch {
    return NextResponse.json({ error: 'Oracle unreachable' }, { status: 502 });
  }

  const data: unknown = await oracleRes.json();
  return NextResponse.json(data, { status: oracleRes.status });
}
