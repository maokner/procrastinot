import pino from 'pino';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: [
        'OPENAI_API_KEY',
        'ORACLE_PRIVATE_KEY',
        'openaiApiKey',
        'oraclePrivateKey',
        '*.OPENAI_API_KEY',
        '*.ORACLE_PRIVATE_KEY',
        '*.openaiApiKey',
        '*.oraclePrivateKey',
      ],
      censor: '[REDACTED]',
    },
  },
  pino.destination(2), // stderr
);
