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
const { degenVaultAbi: degenVaultContractAbi, procrastinotAbi, Status } = abiPkg;
import type { Config } from './config.js';
import type { OracleDb } from './db.js';

// TODO(phase-b): drop cast once abi is non-empty. The `@procrastinot/abi` export
// is currently `[] as const`, which doesn't carry function-name literals, so we
// cast through `unknown as Abi` to keep writeContract/readContract typechecks
// working until Phase B replaces the stub with the real ABI JSON.
const abi = procrastinotAbi as unknown as Abi;
const vaultAbi = degenVaultContractAbi as unknown as Abi;

export type ChainClients = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: ReturnType<typeof privateKeyToAccount>;
  contractAddress: `0x${string}`;
  degenVaultAddress: `0x${string}`;
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
    degenVaultAddress: config.degenVaultAddress,
  };
}

/**
 * Read the cached task+rubric for a commitment id from SQLite. The task and
 * rubric are only available via the `CommitmentCreated` event payload (the
 * contract stores only `taskHash`), so the poller caches them as it ingests
 * events.
 */
export async function getCommitmentTask(
  db: OracleDb,
  commitmentId: bigint,
): Promise<{ task: string; rubric: string } | undefined> {
  const row = await db.getTask(commitmentId.toString());
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

const WRITE_RECEIPT_TIMEOUT_MS = 120_000;

const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const satisfies Abi;

async function waitForWriteReceipt(clients: ChainClients, hash: Hex): Promise<void> {
  await clients.publicClient.waitForTransactionReceipt({
    hash,
    timeout: WRITE_RECEIPT_TIMEOUT_MS,
  });
}

export async function getUsdcAddress(clients: ChainClients): Promise<`0x${string}`> {
  const result = await clients.publicClient.readContract({
    address: clients.contractAddress,
    abi,
    functionName: 'usdc',
  });
  return result as `0x${string}`;
}

export async function getUsdcBalance(
  clients: ChainClients,
  owner: `0x${string}`,
): Promise<bigint> {
  const usdcAddress = await getUsdcAddress(clients);
  const balance = await clients.publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
  });
  return balance;
}

export async function transferUsdc(
  clients: ChainClients,
  args: { to: `0x${string}`; amount: bigint },
): Promise<Hex> {
  if (args.amount <= 0n) {
    throw new Error('USDC transfer amount must be positive.');
  }

  const usdcAddress = await getUsdcAddress(clients);
  const hash = await clients.walletClient.writeContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [args.to, args.amount],
    account: clients.account,
    chain: clients.walletClient.chain,
  });
  await waitForWriteReceipt(clients, hash);
  return hash;
}

export async function topUpDegenVault(
  clients: ChainClients,
  targetAmount: bigint,
): Promise<Hex | null> {
  if (targetAmount <= 0n) return null;

  const vaultBalance = await getUsdcBalance(clients, clients.degenVaultAddress);
  if (vaultBalance >= targetAmount) return null;

  return transferUsdc(clients, {
    to: clients.degenVaultAddress,
    amount: targetAmount - vaultBalance,
  });
}

/**
 * Submit a verdict on-chain and wait for the receipt.
 *
 * Returns the tx hash only after `waitForTransactionReceipt` resolves, so
 * callers can treat a successful return as "the tx actually landed". If the
 * receipt doesn't arrive within {@link WRITE_RECEIPT_TIMEOUT_MS} the
 * wait throws — the poller treats that as transient and leaves the verdict
 * `pending` so a subsequent tick observes the settled state.
 *
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
  await waitForWriteReceipt(clients, hash);
  return hash;
}

export async function submitVerdictToVault(
  clients: ChainClients,
  args: { commitmentId: bigint; reasonHash: Hex },
): Promise<{ verdictTxHash: Hex; topUpTxHash: Hex | null }> {
  const verdictTxHash = await clients.walletClient.writeContract({
    address: clients.contractAddress,
    abi,
    functionName: 'submitVerdictToVault',
    args: [args.commitmentId, args.reasonHash],
    account: clients.account,
    chain: clients.walletClient.chain,
  });
  await waitForWriteReceipt(clients, verdictTxHash);
  return { verdictTxHash, topUpTxHash: null };
}

export async function releaseFromVault(
  clients: ChainClients,
  args: { to: `0x${string}`; amount: bigint },
): Promise<{ topUpTxHash: Hex | null; releaseTxHash: Hex }> {
  if (args.amount <= 0n) {
    throw new Error('Vault release amount must be positive.');
  }

  const topUpTxHash = await topUpDegenVault(clients, args.amount);

  if (clients.account.address.toLowerCase() === clients.degenVaultAddress.toLowerCase()) {
    const releaseTxHash = await transferUsdc(clients, {
      to: args.to,
      amount: args.amount,
    });
    return { topUpTxHash, releaseTxHash };
  }

  const hash = await clients.walletClient.writeContract({
    address: clients.degenVaultAddress,
    abi: vaultAbi,
    functionName: 'releaseFor',
    args: [args.to, args.amount],
    account: clients.account,
    chain: clients.walletClient.chain,
  });
  await waitForWriteReceipt(clients, hash);
  return { topUpTxHash, releaseTxHash: hash };
}
