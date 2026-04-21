import { logger } from './logger.js';

/**
 * Bounded exponential backoff with full jitter. Only retries on transient
 * errors:
 *   - HTTP 429 (rate limit)
 *   - HTTP 5xx
 *   - network-y errors (ECONNRESET, ETIMEDOUT, AbortError, ENOTFOUND, ECONNREFUSED)
 *
 * Does NOT retry on 4xx (except 429) — those are caller errors and retrying
 * wastes time.
 */
export type RetryOptions = {
  tries?: number;
  baseMs?: number;
  maxMs?: number;
  label?: string;
};

export type TransientClassifier = (err: unknown) => boolean;

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
]);

type ErrorLike = {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  name?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  details?: unknown;
  cause?: unknown;
};

function collectErrorChain(err: unknown): ErrorLike[] {
  const chain: ErrorLike[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const entry = current as ErrorLike;
    chain.push(entry);
    current = entry.cause;
  }

  return chain;
}

function describeError(err: unknown): string {
  for (const entry of collectErrorChain(err)) {
    if (typeof entry.message === 'string' && entry.message.length > 0) {
      return entry.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

export function isTransientError(err: unknown): boolean {
  for (const entry of collectErrorChain(err)) {
    // OpenAI SDK puts the HTTP status on `status`; viem on `status` or inside
    // the message. Node's `undici` errors use `code`.
    const status =
      typeof entry.status === 'number'
        ? entry.status
        : typeof entry.statusCode === 'number'
          ? entry.statusCode
          : undefined;
    if (status !== undefined) {
      if (status === 429) return true;
      if (status >= 500 && status < 600) return true;
      // 4xx other than 429 is a caller error — don't retry.
      if (status >= 400 && status < 500) return false;
    }

    if (typeof entry.code === 'string' && NETWORK_CODES.has(entry.code)) return true;
    if (entry.name === 'AbortError') return true;
    if (entry.name === 'TimeoutError') return true;
    if (
      typeof entry.name === 'string' &&
      /\b(fetchrequesterror|requesttimeouterror|apitimeouterror)\b/i.test(entry.name)
    ) {
      return true;
    }

    const msg = [entry.message, entry.shortMessage, entry.details]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join('\n');
    if (
      /\b(ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|socket hang up|fetch failed|network error|request timed out)\b/i.test(
        msg,
      )
    ) {
      return true;
    }
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
  classify: TransientClassifier = isTransientError,
): Promise<T> {
  const tries = opts.tries ?? 3;
  const baseMs = opts.baseMs ?? 500;
  const maxMs = opts.maxMs ?? 10_000;
  const label = opts.label ?? 'retry';

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      const transient = classify(err);
      const hasMore = attempt < tries;
      if (!transient || !hasMore) {
        throw err;
      }
      // Exponential backoff with full jitter: delay ∈ [0, baseMs * 2^(attempt-1)].
      const ceiling = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const delay = Math.floor(Math.random() * ceiling);
      logger.warn(
        {
          label,
          attempt,
          tries,
          delayMs: delay,
          err: describeError(err),
        },
        'retry.transient',
      );
      await sleep(delay);
    }
  }
}
