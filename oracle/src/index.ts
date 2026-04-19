import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createChainClients } from './chain.js';
import { createJudge } from './judge.js';
import { createPoller } from './poller.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // Print a clean message instead of a stack trace for config errors.
    process.stderr.write(`oracle config error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const db = openDb(config.dbPath);
  const clients = createChainClients(config);
  const judge = createJudge({ apiKey: config.openaiApiKey, model: config.openaiModel });
  const poller = createPoller({ config, db, clients, judge });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'oracle.shutdown.start');
    try {
      await poller.stop();
    } finally {
      db.close();
      logger.info('oracle.shutdown.done');
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'oracle.uncaughtException');
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason: String(reason) }, 'oracle.unhandledRejection');
    void shutdown('unhandledRejection');
  });

  poller.start();
}

void main();
