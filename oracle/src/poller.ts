import { keccak256, toBytes, type Hex } from 'viem';
// Namespace import: see note in chain.ts about @procrastinot/abi's current
// (CJS, source-only) package shape.
import * as abiPkg from '@procrastinot/abi';
const { Status } = abiPkg;
import type { Config } from './config.js';
import type { OracleDb } from './db.js';
import type { ChainClients } from './chain.js';
import { getCommitment, submitVerdict } from './chain.js';
import { commitmentCreatedEvent, verdictRequestedEvent } from './events.js';
import { resolveEvidence } from './evidence.js';
import type { Judge } from './judge.js';
import { logger } from './logger.js';

const SCAN_CHUNK_BLOCKS = 5_000n;

export type Poller = {
  start: () => void;
  stop: () => Promise<void>;
};

export function createPoller(args: {
  config: Config;
  db: OracleDb;
  clients: ChainClients;
  judge: Judge;
}): Poller {
  const { config, db, clients, judge } = args;
  let stopping = false;
  let currentTick: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;

  async function ingestEventsChunk(fromBlock: bigint, toBlock: bigint): Promise<void> {
    const [created, requested] = await Promise.all([
      clients.publicClient.getLogs({
        address: clients.contractAddress,
        event: commitmentCreatedEvent,
        fromBlock,
        toBlock,
      }),
      clients.publicClient.getLogs({
        address: clients.contractAddress,
        event: verdictRequestedEvent,
        fromBlock,
        toBlock,
      }),
    ]);

    for (const log of created) {
      const a = log.args;
      if (a.id === undefined || a.task === undefined || a.rubric === undefined) {
        logger.warn({ log }, 'poller.commitmentCreated.missingArgs');
        continue;
      }
      db.upsertTask({
        commitment_id: a.id.toString(),
        task: a.task,
        rubric: a.rubric,
      });
      logger.info({ commitmentId: a.id.toString() }, 'poller.commitmentCreated');
    }

    for (const log of requested) {
      const a = log.args;
      if (a.id === undefined || a.evidenceURI === undefined || a.attemptNumber === undefined) {
        logger.warn({ log }, 'poller.verdictRequested.missingArgs');
        continue;
      }
      const res = db.insertVerdict({
        commitment_id: a.id.toString(),
        attempt_number: Number(a.attemptNumber),
        evidence_uri: a.evidenceURI,
      });
      logger.info(
        {
          commitmentId: a.id.toString(),
          attemptNumber: Number(a.attemptNumber),
          inserted: res.inserted,
        },
        'poller.verdictRequested',
      );
    }
  }

  async function scanNewEvents(): Promise<void> {
    const latest = await clients.publicClient.getBlockNumber();
    const stored = db.getCursor();
    let cursor = stored ?? config.startBlock - 1n;
    if (cursor < config.startBlock - 1n) cursor = config.startBlock - 1n;

    while (cursor < latest) {
      if (stopping) return;
      const from = cursor + 1n;
      const to = from + SCAN_CHUNK_BLOCKS - 1n > latest ? latest : from + SCAN_CHUNK_BLOCKS - 1n;
      logger.debug({ from: from.toString(), to: to.toString() }, 'poller.scan.chunk');
      await ingestEventsChunk(from, to);
      db.setCursor(to);
      cursor = to;
    }
  }

  async function processPendingVerdicts(): Promise<void> {
    const pending = db.getPendingVerdicts();
    for (const row of pending) {
      if (stopping) return;
      await processOne(row.commitment_id, row.attempt_number, row.evidence_uri);
    }
  }

  async function processOne(
    commitmentIdStr: string,
    attemptNumber: number,
    evidenceUri: string | null,
  ): Promise<void> {
    const commitmentId = BigInt(commitmentIdStr);
    const log = logger.child({ commitmentId: commitmentIdStr, attemptNumber });

    if (evidenceUri === null) {
      log.error('poller.pending.missingEvidenceUri');
      db.markVerdictFailed({
        commitment_id: commitmentIdStr,
        attempt_number: attemptNumber,
        reason: 'internal: missing evidence_uri',
      });
      return;
    }

    const task = db.getTask(commitmentIdStr);
    if (!task) {
      // CommitmentCreated event hasn't been ingested yet (e.g. race with
      // reorg or START_BLOCK set too late). Leave pending — next tick may
      // pick up the missing event.
      log.warn('poller.pending.taskNotCached');
      return;
    }

    // Defensive: re-read on-chain state before spending gas. If the
    // commitment is no longer Active someone else resolved it.
    let onchain;
    try {
      onchain = await getCommitment(clients, commitmentId);
    } catch (err) {
      log.error({ err: (err as Error).message }, 'poller.readCommitment.failed');
      db.markVerdictFailed({
        commitment_id: commitmentIdStr,
        attempt_number: attemptNumber,
        reason: `readContract failed: ${(err as Error).message}`,
      });
      return;
    }

    if (onchain.status !== Status.Active) {
      log.info({ status: onchain.status }, 'poller.commitment.alreadyResolved');
      db.markVerdictSubmitted({
        commitment_id: commitmentIdStr,
        attempt_number: attemptNumber,
        passed: false,
        reason: 'skipped: commitment not Active',
        tx_hash: null,
      });
      return;
    }

    // Resolve evidence. On failure, submit passed=false with the canonical
    // reason (per plan 02).
    let evidence: string;
    let evidenceFailed = false;
    try {
      evidence = await resolveEvidence(evidenceUri);
    } catch (err) {
      log.warn(
        { err: (err as Error).message, evidenceUri },
        'poller.evidence.fetchFailed',
      );
      evidence = '';
      evidenceFailed = true;
    }

    let verdict: { passed: boolean; reason: string };
    if (evidenceFailed) {
      verdict = { passed: false, reason: 'evidence could not be retrieved' };
    } else {
      try {
        verdict = await judge.judge({ task: task.task, rubric: task.rubric, evidence });
      } catch (err) {
        log.error({ err: (err as Error).message }, 'poller.judge.failed');
        db.markVerdictFailed({
          commitment_id: commitmentIdStr,
          attempt_number: attemptNumber,
          reason: `judge failed: ${(err as Error).message}`,
        });
        return;
      }
    }

    const reasonHash: Hex = keccak256(toBytes(verdict.reason));

    let txHash: Hex;
    try {
      txHash = await submitVerdict(clients, {
        commitmentId,
        passed: verdict.passed,
        reasonHash,
      });
    } catch (err) {
      log.error({ err: (err as Error).message }, 'poller.submitVerdict.failed');
      db.markVerdictFailed({
        commitment_id: commitmentIdStr,
        attempt_number: attemptNumber,
        reason: `submitVerdict failed: ${(err as Error).message}`,
      });
      return;
    }

    db.markVerdictSubmitted({
      commitment_id: commitmentIdStr,
      attempt_number: attemptNumber,
      passed: verdict.passed,
      reason: verdict.reason,
      tx_hash: txHash,
    });
    log.info({ txHash, passed: verdict.passed }, 'poller.submitVerdict.sent');
  }

  async function tick(): Promise<void> {
    try {
      await scanNewEvents();
      if (stopping) return;
      await processPendingVerdicts();
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'poller.tick.failed');
    }
  }

  function schedule(): void {
    if (stopping) return;
    timer = setTimeout(async () => {
      currentTick = tick();
      await currentTick;
      currentTick = null;
      schedule();
    }, config.pollIntervalMs);
  }

  return {
    start() {
      logger.info(
        {
          chain: config.chain,
          contractAddress: config.contractAddress,
          pollIntervalMs: config.pollIntervalMs,
          startBlock: config.startBlock.toString(),
        },
        'poller.start',
      );
      // Kick off immediately, then on interval.
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
          // tick already logs its own errors
        }
      }
      logger.info('poller.stopped');
    },
  };
}
