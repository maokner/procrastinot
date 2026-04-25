import { createHash, createHmac, randomBytes } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { requireProfile } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  DEFAULT_RISK,
  MIN_BET_UNITS,
  binomialProbabilities,
  expectedValue,
  getMultipliers,
  isPlinkoRows,
  isRiskLevel,
  parseUsdcToUnits,
  unitsToUsdc,
  type RiskLevel,
} from '@/lib/plinko';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const cookieJar = await cookies();
  const { profile } = await requireProfile(cookieJar, '/degen');

  let body: {
    ballValue?: unknown;
    rows?: unknown;
    clientSeed?: unknown;
    risk?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rows = Number(body.rows);
  if (!isPlinkoRows(rows)) {
    return NextResponse.json({ error: 'rows must be 8, 12, or 16' }, { status: 400 });
  }

  const risk: RiskLevel = isRiskLevel(body.risk) ? body.risk : DEFAULT_RISK;

  const ballValueUnits = parseUsdcToUnits(body.ballValue);
  if (ballValueUnits === null) {
    return NextResponse.json({ error: 'Invalid ballValue' }, { status: 400 });
  }
  if (ballValueUnits < BigInt(MIN_BET_UNITS)) {
    return NextResponse.json(
      { error: 'ballValue must be at least 0.10 USDC' },
      { status: 400 },
    );
  }

  const clientSeed = String(body.clientSeed ?? '').slice(0, 128) || 'default';
  const serverSeedBuffer = randomBytes(32);
  const serverSeed = serverSeedBuffer.toString('hex');
  const nonce = Date.now();

  const hmac = createHmac('sha256', serverSeedBuffer);
  hmac.update(`${clientSeed}:${nonce}`);
  const digest = hmac.digest();

  // Fair binomial draw: each row is a 50/50 left/right decision derived
  // from one bit of the HMAC digest. The bucket index is the count of
  // "right" choices, which gives P(k) = C(n,k)/2^n.
  const pathBits: boolean[] = [];
  for (let i = 0; i < rows; i += 1) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    pathBits.push(((digest[byteIndex] >> (7 - bitIndex)) & 1) === 1);
  }
  const path = pathBits.map((bit) => (bit ? '1' : '0')).join('');
  const slot = pathBits.filter(Boolean).length;

  const multipliers = getMultipliers(rows, risk);
  const multiplier = multipliers[slot];
  const payoutUnits =
    (ballValueUnits * BigInt(Math.round(multiplier * 1_000_000))) / 1_000_000n;
  const serverSeedHash = createHash('sha256').update(serverSeedBuffer).digest('hex');

  // Debug log — verify EV math agrees with targetRTP. Cheap; once memoized
  // the multiplier table only computes once per (rows, risk) per process.
  const probs = binomialProbabilities(rows);
  const closedFormEV = expectedValue(rows, risk);
  console.log(
    `[plinko] rows=${rows} risk=${risk} slot=${slot} mult=${multiplier.toFixed(4)} EV=${closedFormEV.toFixed(4)} P(slot)=${probs[slot].toFixed(6)}`,
  );

  const admin = supabaseAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.rpc as any)('process_plinko_drop', {
    p_user_id: profile.id,
    p_ball_value_usdc: Number(ballValueUnits),
    p_rows: rows,
    p_slot: slot,
    p_path: path,
    p_multiplier: multiplier,
    p_payout_usdc: Number(payoutUnits),
    p_server_seed: serverSeed,
    p_server_seed_hash: serverSeedHash,
    p_client_seed: clientSeed,
    p_nonce: nonce,
  });

  if (error) {
    if (error.message.includes('insufficient_balance')) {
      return NextResponse.json({ error: 'Insufficient balance' }, { status: 402 });
    }
    if (error.message.includes('no_balance')) {
      return NextResponse.json({ error: 'No active degen balance' }, { status: 404 });
    }
    console.error('[plinko/drop] RPC error:', error);
    return NextResponse.json({ error: 'Drop failed', detail: error.message }, { status: 500 });
  }

  const result = data?.[0] as
    | {
        drop_id: string;
        balance_before: number;
        balance_after: number;
      }
    | undefined;
  if (!result) {
    return NextResponse.json({ error: 'Drop failed' }, { status: 500 });
  }

  return NextResponse.json({
    dropId: result.drop_id,
    risk,
    path: pathBits,
    slot,
    multiplier,
    multipliers,
    payout: unitsToUsdc(payoutUnits),
    balanceBefore: unitsToUsdc(result.balance_before),
    balanceAfter: unitsToUsdc(result.balance_after),
    serverSeed,
    serverSeedHash,
    clientSeed,
  });
}
