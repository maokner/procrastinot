/**
 * In-process nonce store for SIWE.
 *
 * WARNING: This is a single-process Map. It will silently break in a
 * multi-replica deploy (nonces issued on one node won't verify on another).
 * Before scaling, replace with Redis (recommended) or a short-lived row in
 * Supabase.
 */

const TTL_MS = 5 * 60 * 1000; // 5 minutes

type Entry = { nonce: string; expiresAt: number };

// Keyed by Supabase user.id
const store = new Map<string, Entry>();

/** Sweep expired entries opportunistically. */
function sweep() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
}

export function putNonce(userId: string, nonce: string): void {
  sweep();
  store.set(userId, { nonce, expiresAt: Date.now() + TTL_MS });
}

/** One-shot: returns the nonce and removes it. Null if missing / expired. */
export function popNonce(userId: string): string | null {
  const entry = store.get(userId);
  if (!entry) return null;
  store.delete(userId);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.nonce;
}
