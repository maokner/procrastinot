'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import {
  decodeEventLog,
  parseAbiItem,
  type Abi,
  type Hex,
  type Log,
} from 'viem';
import { ATTEMPT_CAP, Status, type Commitment } from '@procrastinot/abi';
import {
  CONTRACT_ADDRESS,
  CHAIN_ID,
  abi,
  isContractConfigured,
  useCommitment,
} from '@/lib/contract';
import { formatUsdc, toEvidenceURI, etherscanTxUrl } from '@/lib/format';
import { ConnectGate } from '@/components/ConnectGate';
import { StatusBadge } from '@/components/StatusBadge';
import { Countdown } from '@/components/Countdown';

export default function CommitmentPage() {
  const params = useParams<{ id: string }>();
  const idStr = params?.id;
  let id: bigint | undefined;
  try {
    id = idStr ? BigInt(idStr) : undefined;
  } catch {
    id = undefined;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="font-mono text-sm uppercase tracking-widest">
          procrastinot
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/my" className="text-sm text-neutral-400 hover:text-neutral-100">
            My commitments
          </Link>
          <ConnectButton />
        </div>
      </header>

      {id === undefined ? (
        <p className="text-red-400">Invalid commitment id.</p>
      ) : (
        <ConnectGate>
          <CommitmentDetail id={id} />
        </ConnectGate>
      )}
    </main>
  );
}

type Verdict = {
  kind: 'requested' | 'submitted';
  blockNumber: bigint;
  txHash: Hex;
  evidenceURI?: string;
  attemptNumber?: number;
  passed?: boolean;
  reasonHash?: Hex;
};

function CommitmentDetail({ id }: { id: bigint }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const read = useCommitment(id);
  const [pollInterval, setPollInterval] = useState<number | false>(false);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [task, setTask] = useState<string | null>(null);
  const [rubric, setRubric] = useState<string | null>(null);

  // Refetch commitment on interval.
  useEffect(() => {
    if (!pollInterval) return;
    const handle = setInterval(() => {
      void read.refetch();
    }, pollInterval);
    return () => clearInterval(handle);
  }, [pollInterval, read]);

  const commitment = read.data as Commitment | undefined;

  // Stop polling once the commitment leaves Active.
  useEffect(() => {
    if (!commitment) return;
    if (commitment.status !== Status.Active) setPollInterval(false);
  }, [commitment]);

  // Load events (CommitmentCreated for task/rubric, VerdictRequested, VerdictSubmitted).
  useEffect(() => {
    if (!publicClient || !isContractConfigured()) return;
    let cancelled = false;

    async function load() {
      try {
        const createdEvent = parseAbiItem(
          'event CommitmentCreated(uint256 indexed id, address indexed user, address indexed enemy, uint128 stake, uint128 oracleFee, uint64 deadline, string task, string rubric)',
        );
        const requestedEvent = parseAbiItem(
          'event VerdictRequested(uint256 indexed id, string evidenceURI, uint8 attemptNumber)',
        );
        const submittedEvent = parseAbiItem(
          'event VerdictSubmitted(uint256 indexed id, bool passed, bytes32 reasonHash)',
        );

        const createdLogs = await publicClient!.getLogs({
          address: CONTRACT_ADDRESS as `0x${string}`,
          event: createdEvent,
          args: { id },
          fromBlock: 'earliest',
          toBlock: 'latest',
        });
        if (!cancelled) {
          for (const log of createdLogs) {
            try {
              const decoded = decodeEventLog({
                abi: [createdEvent],
                data: log.data,
                topics: log.topics,
              });
              const args = decoded.args as { task: string; rubric: string };
              setTask(args.task);
              setRubric(args.rubric);
              break;
            } catch {
              /* ignore */
            }
          }
        }

        const [reqLogs, subLogs] = await Promise.all([
          publicClient!.getLogs({
            address: CONTRACT_ADDRESS as `0x${string}`,
            event: requestedEvent,
            args: { id },
            fromBlock: 'earliest',
            toBlock: 'latest',
          }),
          publicClient!.getLogs({
            address: CONTRACT_ADDRESS as `0x${string}`,
            event: submittedEvent,
            args: { id },
            fromBlock: 'earliest',
            toBlock: 'latest',
          }),
        ]);

        if (cancelled) return;

        const acc: Verdict[] = [];
        for (const log of reqLogs) {
          acc.push(parseRequestedLog(log));
        }
        for (const log of subLogs) {
          acc.push(parseSubmittedLog(log));
        }
        acc.sort((a, b) => Number(a.blockNumber - b.blockNumber));
        setVerdicts(acc);
      } catch {
        /* ignore */
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [publicClient, id]);

  const { writeContractAsync } = useWriteContract();
  const [evidence, setEvidence] = useState('');
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [txLabel, setTxLabel] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);

  const waitRx = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    query: { enabled: Boolean(txHash) },
  });

  // After any tx confirms, poll commitment every 5s (until Active→Completed/Forfeited).
  useEffect(() => {
    if (waitRx.data) {
      setPollInterval(5000);
      void read.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitRx.data]);

  const now = Math.floor(Date.now() / 1000);
  const deadlinePassed = commitment ? now >= Number(commitment.deadline) : false;
  const isActive = commitment?.status === Status.Active;
  const isOwner =
    address && commitment && address.toLowerCase() === commitment.user.toLowerCase();
  const canSubmit =
    isActive && !deadlinePassed && (commitment?.attemptsUsed ?? 0) < ATTEMPT_CAP && isOwner;
  const canForfeit = isActive && deadlinePassed;

  async function submitEvidence(e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    if (!evidence.trim()) {
      setActionError('Evidence cannot be empty.');
      return;
    }
    try {
      const uri = toEvidenceURI(evidence);
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: abi as Abi,
        functionName: 'requestVerdict',
        args: [id, uri],
      });
      setTxHash(hash);
      setTxLabel('Submitting evidence');
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function doForfeit() {
    setActionError(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: abi as Abi,
        functionName: 'forfeit',
        args: [id],
      });
      setTxHash(hash);
      setTxLabel('Forfeiting');
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  if (!isContractConfigured()) {
    return (
      <p className="text-sm text-neutral-500">
        Set <code>NEXT_PUBLIC_CONTRACT_ADDRESS</code> in <code>.env.local</code> to view commitments.
      </p>
    );
  }

  if (read.isLoading) return <p className="text-neutral-400">Loading…</p>;
  if (read.error) return <p className="text-red-400">Failed to load: {String(read.error)}</p>;
  if (!commitment) return <p className="text-neutral-400">No commitment found.</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Commitment #{id.toString()}</h1>
        <StatusBadge status={commitment.status} />
      </div>

      <div className="grid grid-cols-2 gap-4 rounded border border-neutral-800 bg-neutral-950 p-4 text-sm">
        <Field label="Stake">{formatUsdc(commitment.stake)} USDC</Field>
        <Field label="Oracle fee (remaining)">{formatUsdc(commitment.oracleFee)} USDC</Field>
        <Field label="Attempts">
          {commitment.attemptsUsed} / {ATTEMPT_CAP}
        </Field>
        <Field label="Deadline">
          <Countdown deadline={commitment.deadline} />
        </Field>
        <Field label="User">
          <span className="font-mono text-xs break-all">{commitment.user}</span>
        </Field>
        <Field label="Enemy">
          <span className="font-mono text-xs break-all text-red-300">{commitment.enemy}</span>
        </Field>
      </div>

      {task && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">Task</h2>
          <p className="whitespace-pre-wrap text-neutral-100">{task}</p>
        </section>
      )}
      {rubric && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">Rubric</h2>
          <p className="whitespace-pre-wrap text-neutral-300">{rubric}</p>
        </section>
      )}

      {canSubmit && (
        <form onSubmit={submitEvidence} className="flex flex-col gap-3 rounded border border-neutral-800 bg-neutral-950 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-neutral-300">Evidence</span>
            <input
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="text, URL, or ipfs://…"
              className="rounded border border-neutral-800 bg-neutral-900 p-3 text-neutral-100"
            />
          </label>
          <button
            type="submit"
            disabled={waitRx.isLoading}
            className="self-start rounded bg-neutral-100 px-4 py-2 font-medium text-neutral-950 hover:bg-white disabled:opacity-50"
          >
            Submit evidence
          </button>
        </form>
      )}

      {canForfeit && (
        <button
          onClick={doForfeit}
          disabled={waitRx.isLoading}
          className="self-start rounded border border-red-800 bg-red-950/40 px-4 py-2 font-medium text-red-200 hover:bg-red-950 disabled:opacity-50"
        >
          Forfeit to enemy
        </button>
      )}

      {actionError && (
        <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{actionError}</p>
      )}

      {txHash && (
        <div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-sm">
          <div className="flex items-center justify-between">
            <span>
              {waitRx.isSuccess ? '✓ ' : '… '}
              {txLabel}
            </span>
            <a
              href={etherscanTxUrl(txHash, CHAIN_ID)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-neutral-400 underline"
            >
              etherscan
            </a>
          </div>
        </div>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">Verdict history</h2>
        {verdicts.length === 0 ? (
          <p className="text-sm text-neutral-500">No attempts yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {verdicts.map((v) => (
              <li
                key={`${v.txHash}-${v.kind}`}
                className="rounded border border-neutral-800 bg-neutral-950 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {v.kind === 'requested'
                      ? `Attempt ${v.attemptNumber}: evidence submitted`
                      : v.passed
                        ? 'Oracle: passed'
                        : 'Oracle: rejected'}
                  </span>
                  <a
                    href={etherscanTxUrl(v.txHash, CHAIN_ID)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-neutral-400 underline"
                  >
                    tx
                  </a>
                </div>
                {v.evidenceURI && (
                  <p className="mt-1 break-all font-mono text-xs text-neutral-400">
                    {v.evidenceURI}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function parseRequestedLog(log: Log): Verdict {
  const event = parseAbiItem(
    'event VerdictRequested(uint256 indexed id, string evidenceURI, uint8 attemptNumber)',
  );
  try {
    const decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics });
    const args = decoded.args as { evidenceURI: string; attemptNumber: number };
    return {
      kind: 'requested',
      blockNumber: log.blockNumber ?? 0n,
      txHash: log.transactionHash as Hex,
      evidenceURI: args.evidenceURI,
      attemptNumber: Number(args.attemptNumber),
    };
  } catch {
    return {
      kind: 'requested',
      blockNumber: log.blockNumber ?? 0n,
      txHash: log.transactionHash as Hex,
    };
  }
}

function parseSubmittedLog(log: Log): Verdict {
  const event = parseAbiItem(
    'event VerdictSubmitted(uint256 indexed id, bool passed, bytes32 reasonHash)',
  );
  try {
    const decoded = decodeEventLog({ abi: [event], data: log.data, topics: log.topics });
    const args = decoded.args as { passed: boolean; reasonHash: Hex };
    return {
      kind: 'submitted',
      blockNumber: log.blockNumber ?? 0n,
      txHash: log.transactionHash as Hex,
      passed: args.passed,
      reasonHash: args.reasonHash,
    };
  } catch {
    return {
      kind: 'submitted',
      blockNumber: log.blockNumber ?? 0n,
      txHash: log.transactionHash as Hex,
    };
  }
}
