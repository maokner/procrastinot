import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createChainClients } from './chain.js';
import { createJudge } from './judge.js';
import { createPoller } from './poller.js';
import { createApiServer } from './server.js';
import { createSupabaseAdminClient } from './supabase.js';
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

  const db = openDb({
    supabaseUrl: config.supabaseUrl,
    supabaseServiceRoleKey: config.supabaseServiceRoleKey,
    contractAddress: config.contractAddress,
  });
  const supabase = createSupabaseAdminClient({
    supabaseUrl: config.supabaseUrl,
    supabaseServiceRoleKey: config.supabaseServiceRoleKey,
  });
  const clients = createChainClients(config);
  const judge = createJudge({ apiKey: config.openaiApiKey, model: config.openaiModel });
  const poller = createPoller({ config, db, clients, judge });

  let shuttingDown = false;
  // exitCode = 0 for clean shutdowns (SIGINT/SIGTERM), non-zero for errors.
  // Hosts like Railway restart only on non-zero when policy is "On Failure".
  const shutdown = async (signal: string, exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, exitCode }, 'oracle.shutdown.start');
    try {
      await poller.stop();
    } finally {
      db.close();
      logger.info('oracle.shutdown.done');
      process.exit(exitCode);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'oracle.uncaughtException');
    void shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason: String(reason) }, 'oracle.unhandledRejection');
    void shutdown('unhandledRejection', 1);
  });

  poller.start();
  createApiServer(clients, supabase, config.apiPort);
}

void main();
