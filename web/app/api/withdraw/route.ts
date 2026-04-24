/**
 * POST /api/withdraw
 *
 * Body: { commitmentId: string }
 *
 * Server-side proxy to the Railway oracle's /api/withdraw endpoint.
 * Keeps ORACLE_API_URL out of the browser bundle and avoids CORS issues.
 */
import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';

const ORACLE_API_URL = process.env.ORACLE_API_URL;

export async function POST(request: NextRequest) {
  if (!ORACLE_API_URL) {
    return NextResponse.json({ error: 'Oracle not configured' }, { status: 503 });
  }

  let body: { commitmentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.commitmentId) {
    return NextResponse.json({ error: 'commitmentId is required' }, { status: 400 });
  }

  let oracleRes: Response;
  try {
    oracleRes = await fetch(`${ORACLE_API_URL}/api/withdraw`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitmentId: body.commitmentId }),
    });
  } catch {
    return NextResponse.json({ error: 'Oracle unreachable' }, { status: 502 });
  }

  const data: unknown = await oracleRes.json();
  return NextResponse.json(data, { status: oracleRes.status });
}
