#!/usr/bin/env tsx
/**
 * Reads .env.supabase at the repo root and merges the Supabase vars into:
 *   - indexer/.env                  (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *   - web/.env.local                (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
 *
 * Existing keys are overwritten in place; other keys are preserved; missing
 * files are created from their .env.example siblings.
 *
 * Run after populating .env.supabase:  pnpm distribute:env
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const sharedPath = resolve(repoRoot, '.env.supabase');
if (!existsSync(sharedPath)) {
  console.error(`[distribute:env] ${sharedPath} not found`);
  console.error(`[distribute:env] Copy .env.supabase.example and fill in the values first.`);
  process.exit(1);
}

const shared = parseEnv(readFileSync(sharedPath, 'utf8'));
const url = shared['SUPABASE_URL'];
const anon = shared['SUPABASE_ANON_KEY'];
const service = shared['SUPABASE_SERVICE_ROLE_KEY'];
if (!url || !anon || !service) {
  console.error('[distribute:env] .env.supabase is missing one of SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

upsert(resolve(repoRoot, 'indexer/.env'), resolve(repoRoot, 'indexer/.env.example'), {
  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: service,
});

upsert(resolve(repoRoot, 'web/.env.local'), resolve(repoRoot, 'web/.env.example'), {
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
  SUPABASE_SERVICE_ROLE_KEY: service,
});

console.log('[distribute:env] done — Supabase vars merged into indexer/.env and web/.env.local');

// ---------- helpers ----------

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim();
  }
  return out;
}

function upsert(targetPath: string, examplePath: string, merge: Record<string, string>) {
  if (!existsSync(targetPath)) {
    if (!existsSync(examplePath)) {
      console.error(`[distribute:env] neither ${targetPath} nor ${examplePath} exists`);
      process.exit(1);
    }
    copyFileSync(examplePath, targetPath);
  }
  const text = readFileSync(targetPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const mergedKeys = new Set(Object.keys(merge));
  const seen = new Set<string>();
  const rewritten = lines.map((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m || !mergedKeys.has(m[1])) return line;
    seen.add(m[1]);
    return `${m[1]}=${merge[m[1]]}`;
  });
  for (const key of mergedKeys) {
    if (!seen.has(key)) rewritten.push(`${key}=${merge[key]}`);
  }
  writeFileSync(targetPath, rewritten.join('\n'));
  console.log(`[distribute:env] merged ${[...mergedKeys].join(', ')} into ${targetPath}`);
}
