import type { Hex, Log } from 'viem';
import type { Config } from './config.js';
import type { IndexerDb } from './db.js';
import { procrastinotAbi, type ChainClients } from './chain.js';
import { logger } from './logger.js';

const EVENT_NAMES = [
  'CommitmentCreated',
  'VerdictRequested',
  'VerdictSubmitted',
  'Completed',
  'Forfeited',
] as const;
type EventName = (typeof EVENT_NAMES)[number];

// Build a map of event name -> AbiEvent for convenience.
const eventAbis = Object.fromEntries(
  procrastinotAbi
    .filter((x): x is Extract<typeof procrastinotAbi[number], { type: 'event' }> => x.type === 'event')
    .map((e) => [e.name, e] as const),
);

// How often to try re-resolving null profile ids. Only runs in steady
// state (after backfill); cheap enough to run every minute.
const RERESOLVE_INTERVAL_MS = 60_000;

export type Poller = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

type AnyLog = Log & { args: Record<string, unknown> };

export function createPoller(args: {
  config: Config;
  db: IndexerDb;
  clients: ChainClients;
}): Poller {
  const { config, db, clients } = args;
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;
  let currentTick: Promise<void> | null = null;
  let lastReresolveAt = 0;

  // Cache of block number -> timestamp (seconds). Avoid refetching the
  // same block multiple times inside a single chunk.
  const blockTimestampCache = new Map<bigint, bigint>();
  async function getBlockTimestamp(blockNumber: bigint): Promise<bigint> {
    const cached = blockTimestampCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await clients.publicClient.getBlock({ blockNumber });
    const ts = block.timestamp;
    blockTimestampCache.set(blockNumber, ts);
    // Keep the cache bounded.
    if (blockTimestampCache.size > 1000) {
      const firstKey = blockTimestampCache.keys().next().value;
      if (firstKey !== undefined) blockTimestampCache.delete(firstKey);
    }
    return ts;
  }

  async function fetchLogsForEvent(
    name: EventName,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<AnyLog[]> {
    const event = eventAbis[name];
    if (!event) throw new Error(`internal: unknown event ${name}`);
    const logs = await clients.publicClient.getLogs({
      address: clients.contractAddress,
      event,
      fromBlock,
      toBlock,
    });
    return logs as unknown as AnyLog[];
  }

  async function processLog(name: EventName, log: AnyLog): Promise<void> {
    const a = log.args;
    const txHash = log.transactionHash as Hex;
    const blockNumber = log.blockNumber!;
    const ts = await getBlockTimestamp(blockNumber);
    const idArg = a.id as bigint | undefined;

    switch (name) {
      case 'CommitmentCreated': {
        if (idArg === undefined || a.user === undefined || a.enemy === undefined) {
          logger.warn({ log }, 'poller.commitmentCreated.missingArgs');
          return;
        }
        await db.upsertCommitmentCreated({
          id: idArg,
          user: a.user as `0x${string}`,
          enemy: a.enemy as `0x${string}`,
          stake: a.stake as bigint,
          oracleFee: a.oracleFee as bigint,
          deadline: a.deadline as bigint,
          task: (a.task as string) ?? '',
          rubric: (a.rubric as string) ?? '',
          txHash,
          blockTimestamp: ts,
        });
        logger.info(
          { id: idArg.toString(), blockNumber: blockNumber.toString() },
          'poller.commitmentCreated',
        );
        return;
      }
      case 'VerdictRequested': {
        if (idArg === undefined || a.attemptNumber === undefined) {
          logger.warn({ log }, 'poller.verdictRequested.missingArgs');
          return;
        }
        await db.updateCommitmentOnVerdictRequested({
          id: idArg,
          evidenceURI: (a.evidenceURI as string) ?? '',
          attemptNumber: Number(a.attemptNumber),
          txHash,
          blockNumber,
          blockTimestamp: ts,
        });
        logger.info(
          {
            id: idArg.toString(),
            attempt: Number(a.attemptNumber),
          },
          'poller.verdictRequested',
        );
        return;
      }
      case 'VerdictSubmitted': {
        if (idArg === undefined || a.passed === undefined) {
          logger.warn({ log }, 'poller.verdictSubmitted.missingArgs');
          return;
        }
        await db.updateCommitmentOnVerdictSubmitted({
          id: idArg,
          passed: a.passed as boolean,
          reasonHash: a.reasonHash as Hex,
          txHash,
          blockNumber,
          blockTimestamp: ts,
        });
        logger.info(
          { id: idArg.toString(), passed: a.passed },
          'poller.verdictSubmitted',
        );
        return;
      }
      case 'Completed': {
        if (idArg === undefined) {
          logger.warn({ log }, 'poller.completed.missingArgs');
          return;
        }
        await db.updateCommitmentOnCompleted({ id: idArg, txHash });
        logger.info({ id: idArg.toString() }, 'poller.completed');
        return;
      }
      case 'Forfeited': {
        if (idArg === undefined) {
          logger.warn({ log }, 'poller.forfeited.missingArgs');
          return;
        }
        await db.updateCommitmentOnForfeited({
          id: idArg,
          txHash,
          blockNumber,
          blockTimestamp: ts,
        });
        logger.info({ id: idArg.toString() }, 'poller.forfeited');
        return;
      }
    }
  }

  async function processChunk(fromBlock: bigint, toBlock: bigint): Promise<void> {
    // Fetch all event types in parallel for this chunk.
    const lists = await Promise.all(
      EVENT_NAMES.map(async (name) => {
        const logs = await fetchLogsForEvent(name, fromBlock, toBlock);
        return logs.map((l) => ({ name, log: l }));
      }),
    );
    const all = lists.flat();

    // Sort oldest-first: block ascending, then log index ascending.
    all.sort((a, b) => {
      const ba = a.log.blockNumber ?? 0n;
      const bb = b.log.blockNumber ?? 0n;
      if (ba !== bb) return ba < bb ? -1 : 1;
      const la = a.log.logIndex ?? 0;
      const lb = b.log.logIndex ?? 0;
      return la - lb;
    });

    for (const { name, log } of all) {
      if (stopping) return;
      await processLog(name, log);
    }
  }

  async function ensureCursor(): Promise<bigint> {
    const existing = await db.getCursor();
    if (existing !== null) return existing;
    // First run: seed at (START_BLOCK - 1). The next block to process is
    // cursor+1 = START_BLOCK, which is what we want (inclusive of the
    // deploy block).
    const seed = config.startBlock - 1n;
    await db.setCursor(seed);
    logger.info({ seed: seed.toString() }, 'poller.cursor.seeded');
    return seed;
  }

  async function scanToHead(): Promise<void> {
    const head = await clients.publicClient.getBlockNumber();
    let cursor = await ensureCursor();
    if (cursor >= head) return;

    logger.info(
      { from: (cursor + 1n).toString(), to: head.toString() },
      'backfill.start',
    );

    while (cursor < head) {
      if (stopping) return;
      const from = cursor + 1n;
      const endOfChunk = from + config.backfillChunk - 1n;
      const to = endOfChunk > head ? head : endOfChunk;
      const t0 = Date.now();
      await processChunk(from, to);
      // Persist cursor AFTER the chunk is fully processed. A crash mid-
      // chunk re-processes the chunk on restart, which is safe because
      // upserts are keyed by id and verdict_events inserts SELECT-first.
      await db.setCursor(to);
      cursor = to;
      logger.info(
        {
          from: from.toString(),
          to: to.toString(),
          ms: Date.now() - t0,
        },
        'backfill.chunk',
      );
    }

    logger.info({ head: head.toString() }, 'backfill.done');
  }

  async function tick(): Promise<void> {
    try {
      await scanToHead();
      if (stopping) return;
      // Re-resolve null profile ids at most once per RERESOLVE_INTERVAL_MS.
      const now = Date.now();
      if (now - lastReresolveAt >= RERESOLVE_INTERVAL_MS) {
        lastReresolveAt = now;
        try {
          const n = await db.reresolveNullProfiles();
          if (n > 0) logger.info({ updated: n }, 'poller.reresolve.done');
        } catch (err) {
          logger.warn({ err: (err as Error).message }, 'poller.reresolve.failed');
        }
      }
      logger.debug('poll.tick');
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'poller.tick.failed');
    }
  }

  function schedule(): void {
    if (stopping) return;
    timer = setTimeout(async () => {
      logger.debug('poll.tick');
      currentTick = tick();
      await currentTick;
      currentTick = null;
      schedule();
    }, config.pollIntervalMs);
  }

  return {
    async start() {
      logger.info(
        {
          chain: config.chain,
          contractAddress: config.contractAddress,
          pollIntervalMs: config.pollIntervalMs,
          backfillChunk: config.backfillChunk.toString(),
          startBlock: config.startBlock.toString(),
        },
        'poller.start',
      );
      currentTick = tick().then(() => {
        currentTick = null;
        schedule();
      });
    },
    async stop() {
      stopping = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (currentTick) {
        try {
          await currentTick;
        } catch {
          // already logged
        }
      }
      logger.info('poller.stopped');
    },
  };
}
