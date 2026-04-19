import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';
// Use namespace import for value bindings because the @procrastinot/abi
// package currently ships TS sources without a `type: module` field, so
// Node's ESM loader cannot statically detect named re-exports from its
// `index.ts` (which uses `export *`). Namespace/default interop works
// regardless; repo-infra may tighten this later.
import type { Commitment, Status as StatusT } from '@procrastinot/abi';
import * as abiPkg from '@procrastinot/abi';
const { procrastinotAbi, Status } = abiPkg;
import type { Config } from './config.js';
import type { OracleDb } from './db.js';

// TODO(phase-b): drop cast once abi is non-empty. The `@procrastinot/abi` export
// is currently `[] as const`, which doesn't carry function-name literals, so we
// cast through `unknown as Abi` to keep writeContract/readContract typechecks
// working until Phase B replaces the stub with the real ABI JSON.
const abi = procrastinotAbi as unknown as Abi;

export type ChainClients = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
  contractAddress: `0x${string}`;
};

export function createChainClients(config: Config): ChainClients {
  const chain = config.chain === 'sepolia' ? sepolia : mainnet;
  const transport = http(config.rpcUrl);
  const account = privateKeyToAccount(config.oraclePrivateKey);

  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  return {
    publicClient,
    walletClient,
    account,
    contractAddress: config.contractAddress,
  };
}

/**
 * Read the cached task+rubric for a commitment id from SQLite. The task and
 * rubric are only available via the `CommitmentCreated` event payload (the
 * contract stores only `taskHash`), so the poller caches them as it ingests
 * events.
 */
export function getCommitmentTask(
  db: OracleDb,
  commitmentId: bigint,
): { task: string; rubric: string } | undefined {
  const row = db.getTask(commitmentId.toString());
  if (!row) return undefined;
  return { task: row.task, rubric: row.rubric };
}

type OnChainCommitmentTuple = readonly [
  `0x${string}`, // user
  `0x${string}`, // enemy
  bigint, // stake
  bigint, // oracleFee
  bigint, // initialOracleFee
  bigint, // deadline
  number, // attemptsUsed
  number, // status
  `0x${string}`, // taskHash
];

function normalizeCommitment(raw: unknown): Commitment {
  // Solidity structs come back as either a positional tuple or a keyed object
  // depending on ABI inference. Handle both shapes defensively.
  if (Array.isArray(raw)) {
    const t = raw as unknown as OnChainCommitmentTuple;
    return {
      user: t[0],
      enemy: t[1],
      stake: t[2],
      oracleFee: t[3],
      initialOracleFee: t[4],
      deadline: t[5],
      attemptsUsed: Number(t[6]),
      status: t[7] as StatusT,
      taskHash: t[8],
    };
  }
  const o = raw as {
    user: `0x${string}`;
    enemy: `0x${string}`;
    stake: bigint;
    oracleFee: bigint;
    initialOracleFee: bigint;
    deadline: bigint;
    attemptsUsed: number | bigint;
    status: number;
    taskHash: `0x${string}`;
  };
  return {
    user: o.user,
    enemy: o.enemy,
    stake: o.stake,
    oracleFee: o.oracleFee,
    initialOracleFee: o.initialOracleFee,
    deadline: o.deadline,
    attemptsUsed: Number(o.attemptsUsed),
    status: o.status as StatusT,
    taskHash: o.taskHash,
  };
}

/**
 * Read the current commitment state from chain. Used defensively before
 * submitting a verdict to skip already-resolved commitments.
 */
export async function getCommitment(
  clients: ChainClients,
  commitmentId: bigint,
): Promise<Commitment> {
  const result = await clients.publicClient.readContract({
    address: clients.contractAddress,
    abi,
    functionName: 'getCommitment',
    args: [commitmentId],
  });
  return normalizeCommitment(result);
}

/**
 * Submit a verdict on-chain. Returns the tx hash (not awaited to mined).
 * Caller is responsible for SQLite idempotency and for pre-flighting the
 * on-chain status to avoid wasted gas.
 */
export async function submitVerdict(
  clients: ChainClients,
  args: { commitmentId: bigint; passed: boolean; reasonHash: Hex },
): Promise<Hex> {
  const hash = await clients.walletClient.writeContract({
    address: clients.contractAddress,
    abi,
    functionName: 'submitVerdict',
    args: [args.commitmentId, args.passed, args.reasonHash],
    account: clients.account,
    chain: clients.walletClient.chain,
  });
  return hash;
}
