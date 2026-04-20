import { loadConfig } from './config.js';
import { createChainClients } from './chain.js';
import { createDb } from './db.js';
import { createPoller } from './poller.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    process.stderr.write(`indexer config error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const clients = createChainClients(config);
  const db = createDb(config);
  const poller = createPoller({ config, db, clients });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'indexer.shutdown.start');
    try {
      await poller.stop();
    } finally {
      logger.info('indexer.shutdown.done');
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'indexer.uncaughtException');
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason: String(reason) }, 'indexer.unhandledRejection');
    void shutdown('unhandledRejection');
  });

  await poller.start();
}

void main();
