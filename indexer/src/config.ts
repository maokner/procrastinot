import 'dotenv/config';

export type Config = {
  rpcUrl: string;
  chain: 'sepolia' | 'mainnet';
  contractAddress: `0x${string}`;
  startBlock: bigint;
  pollIntervalMs: number;
  backfillChunk: bigint;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(
      `Missing required env var: ${name}. See indexer/.env.example for the full list.`,
    );
  }
  return v;
}

function parseAddress(name: string, raw: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(`Env var ${name} must be a 0x-prefixed 20-byte address.`);
  }
  return raw as `0x${string}`;
}

function parseBigInt(name: string, raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`Env var ${name} must be an integer, got "${raw}".`);
  }
}

function parsePositiveInteger(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`Env var ${name} must be a positive integer, got "${raw}".`);
  }
  return n;
}

function parsePositiveBigInt(name: string, raw: string): bigint {
  const b = parseBigInt(name, raw);
  if (b <= 0n) {
    throw new Error(`Env var ${name} must be a positive integer, got "${raw}".`);
  }
  return b;
}

export function loadConfig(): Config {
  const chainRaw = (process.env.CHAIN ?? 'sepolia').toLowerCase();
  if (chainRaw !== 'sepolia' && chainRaw !== 'mainnet') {
    throw new Error(`CHAIN must be "sepolia" or "mainnet", got "${chainRaw}".`);
  }

  return {
    rpcUrl: requireEnv('RPC_URL'),
    chain: chainRaw,
    contractAddress: parseAddress('CONTRACT_ADDRESS', requireEnv('CONTRACT_ADDRESS')),
    startBlock: parseBigInt('START_BLOCK', requireEnv('START_BLOCK')),
    pollIntervalMs: parsePositiveInteger(
      'POLL_INTERVAL_MS',
      process.env.POLL_INTERVAL_MS ?? '5000',
    ),
    backfillChunk: parsePositiveBigInt(
      'BACKFILL_CHUNK',
      process.env.BACKFILL_CHUNK ?? '5000',
    ),
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  };
}
