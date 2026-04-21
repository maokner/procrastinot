/**
 * Server-only env-var loader for secrets that are required by API routes
 * and middleware. Throws loudly on access when a required var is missing
 * (fail fast at request time; Next 15 swallows module-scope errors).
 *
 * DO NOT import this from client components — bundlers would try to
 * resolve these at build time and silently inline them into the browser
 * bundle. Call the getters only from route handlers / server actions /
 * server components.
 */

/**
 * The Supabase project's JWT secret (HS256) — used to mint authenticated
 * sessions server-side after a successful SIWE verification. Found in the
 * Supabase dashboard under Settings → API → JWT Secret.
 *
 * NEVER expose this to the browser. If it leaks, rotate it immediately
 * from the same dashboard page.
 */
export function siweJwtSecret(): string {
  const v = process.env.SIWE_JWT_SECRET;
  if (!v) {
    throw new Error(
      'SIWE_JWT_SECRET missing — set the Supabase JWT secret as an env var. ' +
        'Dashboard → Settings → API → JWT Secret.',
    );
  }
  return v;
}

/**
 * Canonical public origin of the deployed web app (e.g.
 * `https://procrastinot.vercel.app`). Preferred over the request's
 * `Host` header when binding SIWE domain, because the Host header is
 * attacker-controllable behind a misconfigured proxy.
 *
 * Returns `null` if unset — callers should then fall back to `Host`.
 */
export function siteUrl(): string | null {
  const v = process.env.NEXT_PUBLIC_SITE_URL;
  return v && v.length > 0 ? v : null;
}

/**
 * Extract the bare host (no scheme, no path) from NEXT_PUBLIC_SITE_URL.
 * Returns `null` if the env var is unset or malformed.
 */
export function siteHost(): string | null {
  const raw = siteUrl();
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}
