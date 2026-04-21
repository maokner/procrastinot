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
import type { Evidence } from './evidence.js';
import { resolveEvidence } from './evidence.js';
import type { Judge } from './judge.js';
import { logger } from './logger.js';
import { isTransientError, retry } from './retry.js';

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

  function describeError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  function flattenError(err: unknown): string {
    const parts: string[] = [];
    const seen = new Set<unknown>();
    let current: unknown = err;

    while (current && typeof current === 'object' && !seen.has(current)) {
      seen.add(current);
      const entry = current as {
        name?: unknown;
        message?: unknown;
        shortMessage?: unknown;
        details?: unknown;
        cause?: unknown;
      };

      if (typeof entry.name === 'string' && entry.name.length > 0) {
        parts.push(entry.name);
      }
      if (typeof entry.message === 'string' && entry.message.length > 0) {
        parts.push(entry.message);
      }
      if (typeof entry.shortMessage === 'string' && entry.shortMessage.length > 0) {
        parts.push(entry.shortMessage);
      }
      if (typeof entry.details === 'string' && entry.details.length > 0) {
        parts.push(entry.details);
      }

      current = entry.cause;
    }

    if (parts.length === 0) {
      parts.push(describeError(err));
    }

    return parts.join('\n');
  }

  function isReceiptTimeoutError(err: unknown): boolean {
    const text = flattenError(err);
    return (
      /\bWaitForTransactionReceiptTimeoutError\b/.test(text) ||
      /Timed out while waiting for transaction .* to be confirmed\./i.test(text)
    );
  }

  function isInsufficientFundsError(err: unknown): boolean {
    const text = flattenError(err);
    return (
      /\bInsufficientFundsError\b/.test(text) ||
      /insufficient funds|exceeds transaction sender account balance|exceeds the balance of the account/i.test(
        text,
      )
    );
  }

  function extractBalanceHint(err: unknown): string {
    const text = flattenError(err);
    const patterns = [
      /\bbalance[:=]\s*([^\n,]+)/i,
      /\bhave\s+([^\n,]+?)(?:,\s*want|\s*$)/i,
      /\baccount balance[:=]?\s*([^\n,]+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    return 'unknown';
  }

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
      await db.upsertTask({
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
      const res = await db.insertVerdict({
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
    const stored = await db.getCursor();
    let cursor = stored ?? config.startBlock - 1n;
    if (cursor < config.startBlock - 1n) cursor = config.startBlock - 1n;

    while (cursor < latest) {
      if (stopping) return;
      const from = cursor + 1n;
      const to =
        from + config.scanChunkBlocks - 1n > latest
          ? latest
          : from + config.scanChunkBlocks - 1n;
      logger.debug({ from: from.toString(), to: to.toString() }, 'poller.scan.chunk');
      await ingestEventsChunk(from, to);
      await db.setCursor(to);
      cursor = to;
    }
  }

  async function processPendingVerdicts(): Promise<void> {
    const pending = await db.getPendingVerdicts();
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
      await db.markVerdictFailed({
        commitment_id: commitmentIdStr,
        attempt_number: attemptNumber,
        reason: 'internal: missing evidence_uri',
      });
      return;
    }

    const task = await db.getTask(commitmentIdStr);
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
      onchain = await retry(() => getCommitment(clients, commitmentId), {
        tries: 3,
        baseMs: 500,
        label: 'chain.getCommitment',
      });
    } catch (err) {
      log.error({ err: describeError(err) }, 'poller.readCommitment.pending');
      return;
    }

    if (onchain.status !== Status.Active) {
      log.info({ status: onchain.status }, 'poller.commitment.alreadyResolved');
      await db.markVerdictSubmitted({
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
    let evidence: Evidence | null = null;
    let evidenceFailed = false;
    try {
      evidence = await resolveEvidence(evidenceUri);
    } catch (err) {
      log.warn({ err: describeError(err), evidenceUri }, 'poller.evidence.fetchFailed');
      evidenceFailed = true;
    }

    let verdict: { passed: boolean; reason: string };
    if (evidenceFailed || evidence === null) {
      verdict = { passed: false, reason: 'evidence could not be retrieved' };
    } else {
      try {
        verdict = await judge.judge({ task: task.task, rubric: task.rubric, evidence });
      } catch (err) {
        log.error({ err: describeError(err) }, 'poller.judge.pending');
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
      const errorMessage = describeError(err);
      if (isInsufficientFundsError(err)) {
        logger.fatal(
          {
            commitmentId: commitmentIdStr,
            attemptNumber,
            balance: extractBalanceHint(err),
            err: errorMessage,
          },
          'oracle.gasDepleted',
        );
        return;
      }
      if (isReceiptTimeoutError(err)) {
        log.warn({ err: errorMessage }, 'poller.submitVerdict.receiptPending');
        return;
      }
      if (isTransientError(err)) {
        log.warn({ err: errorMessage }, 'poller.submitVerdict.pending');
        return;
      }
      log.error({ err: errorMessage }, 'poller.submitVerdict.failed');
      await db.markVerdictFailed({
        commitment_id: commitmentIdStr,
        attempt_number: attemptNumber,
        reason: `submitVerdict failed: ${errorMessage}`,
      });
      return;
    }

    await db.markVerdictSubmitted({
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
      logger.error({ err: describeError(err) }, 'poller.tick.failed');
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
          scanChunkBlocks: config.scanChunkBlocks.toString(),
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
