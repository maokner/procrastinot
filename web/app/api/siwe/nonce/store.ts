/**
 * In-process nonce store for SIWE.
 *
 * Keyed by the lowercased wallet address. Pre-auth by design — the caller
 * is about to prove ownership of that address via the SIWE signature; we
 * only need to ensure the nonce we verify against is the same one the
 * server issued in the last 5 minutes.
 *
 * WARNING: This is a single-process Map. It will silently break in a
 * multi-replica deploy (nonces issued on one node won't verify on another).
 * Before scaling, replace with Redis (recommended) or a short-lived row in
 * Supabase.
 */

const TTL_MS = 5 * 60 * 1000; // 5 minutes

type Entry = { nonce: string; expiresAt: number };

// Keyed by lowercased 0x-prefixed address.
const store = new Map<string, Entry>();

/** Sweep expired entries opportunistically. */
function sweep() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
}

export function putNonce(key: string, nonce: string): void {
  sweep();
  store.set(key, { nonce, expiresAt: Date.now() + TTL_MS });
}

/** One-shot: returns the nonce and removes it. Null if missing / expired. */
export function popNonce(key: string): string | null {
  const entry = store.get(key);
  if (!entry) return null;
  store.delete(key);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.nonce;
}
