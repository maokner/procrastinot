import 'dotenv/config';
import type { Hex } from 'viem';

export type Config = {
  rpcUrl: string;
  chain: 'sepolia' | 'mainnet';
  oraclePrivateKey: Hex;
  contractAddress: `0x${string}`;
  degenVaultAddress: `0x${string}`;
  openaiApiKey: string;
  openaiModel: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  pollIntervalMs: number;
  startBlock: bigint;
  scanChunkBlocks: bigint;
  apiPort: number;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(
      `Missing required env var: ${name}. See oracle/.env.example for the full list.`,
    );
  }
  return v;
}

function parseHex(name: string, raw: string): Hex {
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(`Env var ${name} must be a 0x-prefixed hex string.`);
  }
  return raw as Hex;
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

function parseInteger(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`Env var ${name} must be a positive integer, got "${raw}".`);
  }
  return n;
}

function parsePositiveBigInt(name: string, raw: string): bigint {
  let v: bigint;
  try {
    v = BigInt(raw);
  } catch {
    throw new Error(`Env var ${name} must be a positive integer, got "${raw}".`);
  }
  if (v <= 0n) {
    throw new Error(`Env var ${name} must be a positive integer, got "${raw}".`);
  }
  return v;
}

export function loadConfig(): Config {
  const chainRaw = (process.env.CHAIN ?? 'sepolia').toLowerCase();
  if (chainRaw !== 'sepolia' && chainRaw !== 'mainnet') {
    throw new Error(`CHAIN must be "sepolia" or "mainnet", got "${chainRaw}".`);
  }

  return {
    rpcUrl: requireEnv('RPC_URL'),
    chain: chainRaw,
    oraclePrivateKey: parseHex('ORACLE_PRIVATE_KEY', requireEnv('ORACLE_PRIVATE_KEY')),
    contractAddress: parseAddress('CONTRACT_ADDRESS', requireEnv('CONTRACT_ADDRESS')),
    degenVaultAddress: parseAddress(
      'DEGEN_VAULT_ADDRESS',
      requireEnv('DEGEN_VAULT_ADDRESS'),
    ),
    openaiApiKey: requireEnv('OPENAI_API_KEY'),
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    pollIntervalMs: parseInteger('POLL_INTERVAL_MS', process.env.POLL_INTERVAL_MS ?? '5000'),
    startBlock: parseBigInt('START_BLOCK', requireEnv('START_BLOCK')),
    scanChunkBlocks: parsePositiveBigInt(
      'SCAN_CHUNK_BLOCKS',
      process.env.SCAN_CHUNK_BLOCKS ?? '5000',
    ),
    apiPort: parseInteger('ORACLE_API_PORT', process.env.ORACLE_API_PORT ?? '3001'),
  };
}
