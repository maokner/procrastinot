import pino from 'pino';

/**
 * pino logger for the indexer.
 *
 * Writes to stderr so that (a) tsx watch / docker logs capture it, and
 * (b) it never tangles with stdout-mode pipes.
 *
 * Redaction: the SUPABASE_SERVICE_ROLE_KEY is the only real secret the
 * indexer holds. We redact it under the env-var name and under the config
 * key we use (`supabaseServiceRoleKey`) so that accidental log.info(config)
 * calls don't leak it.
 */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'SUPABASE_SERVICE_ROLE_KEY',
        'supabaseServiceRoleKey',
        '*.SUPABASE_SERVICE_ROLE_KEY',
        '*.supabaseServiceRoleKey',
      ],
      censor: '[REDACTED]',
    },
  },
  pino.destination(2), // stderr
);
