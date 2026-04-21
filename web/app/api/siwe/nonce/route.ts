/**
 * POST /api/siwe/nonce
 *
 * Body: { address: string }
 *
 * Pre-auth — the wallet is about to sign a SIWE message to prove it owns
 * `address`. We issue a fresh single-use nonce bound to the lowercased
 * address with a 5-minute TTL. The companion /api/siwe/verify route pops
 * and compares.
 *
 * GET is kept as an alias that reads `?address=` so the browser can call
 * with `fetch('/api/siwe/nonce?address=0x…')` too. Either works.
 *
 * NOTE: The nonce store is in-process (see `./store`). It works only for
 * a single Node.js process. Before deploying behind more than one
 * replica, replace the Map with Redis or a Postgres table.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { generateNonce } from 'siwe';
import { putNonce } from './store';

export const runtime = 'nodejs';

// EIP-55 and lowercase both match.
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function normaliseAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (!ADDRESS_RE.test(raw)) return null;
  return raw.toLowerCase();
}

export async function POST(request: NextRequest) {
  let body: { address?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const address = normaliseAddress(body.address);
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 });
  }
  const nonce = generateNonce();
  putNonce(address, nonce);
  return NextResponse.json({ nonce });
}

export async function GET(request: NextRequest) {
  const address = normaliseAddress(request.nextUrl.searchParams.get('address'));
  if (!address) {
    return NextResponse.json({ error: 'address query param required' }, { status: 400 });
  }
  const nonce = generateNonce();
  putNonce(address, nonce);
  return NextResponse.json({ nonce });
}
