'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import {
  createPublicClient,
  decodeEventLog,
  http,
  isAddress,
  parseAbiItem,
  type Abi,
  type Hex,
} from 'viem';
import { mainnet } from 'wagmi/chains';
import {
  CONTRACT_ADDRESS,
  CHAIN_ID,
  USDC_ADDRESS,
  abi,
  erc20Abi,
  isContractConfigured,
} from '@/lib/contract';
import { parseUsdc, etherscanTxUrl } from '@/lib/format';
import { ConnectGate } from '@/components/ConnectGate';

const mainnetClient = createPublicClient({ chain: mainnet, transport: http() });

type Step = 'idle' | 'approving' | 'creating' | 'done' | 'error';

export default function CreatePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="font-mono text-sm uppercase tracking-widest">
          procrastinot
        </Link>
        <ConnectButton />
      </header>
      <h1 className="mb-6 text-2xl font-semibold">New commitment</h1>
      <ConnectGate>
        <CreateForm />
      </ConnectGate>
    </main>
  );
}

function CreateForm() {
  const router = useRouter();
  const { address } = useAccount();
  const [task, setTask] = useState('');
  const [rubric, setRubric] = useState('');
  const [enemyInput, setEnemyInput] = useState('');
  const [enemyResolved, setEnemyResolved] = useState<`0x${string}` | null>(null);
  const [ensLoading, setEnsLoading] = useState(false);
  const [stake, setStake] = useState('');
  const [oracleFee, setOracleFee] = useState('0.25');
  const [deadlineLocal, setDeadlineLocal] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [approveHash, setApproveHash] = useState<Hex | null>(null);
  const [createHash, setCreateHash] = useState<Hex | null>(null);

  // Resolve ENS on mainnet if input looks like a name.
  useEffect(() => {
    const trimmed = enemyInput.trim();
    if (!trimmed) {
      setEnemyResolved(null);
      return;
    }
    if (isAddress(trimmed)) {
      setEnemyResolved(trimmed as `0x${string}`);
      return;
    }
    if (/\.eth$/i.test(trimmed)) {
      let cancelled = false;
      setEnsLoading(true);
      mainnetClient
        .getEnsAddress({ name: trimmed })
        .then((addr) => {
          if (cancelled) return;
          setEnemyResolved(addr ?? null);
        })
        .catch(() => {
          if (!cancelled) setEnemyResolved(null);
        })
        .finally(() => {
          if (!cancelled) setEnsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    setEnemyResolved(null);
  }, [enemyInput]);

  const stakeWei = useMemo(() => {
    try {
      return parseUsdc(stake);
    } catch {
      return 0n;
    }
  }, [stake]);
  const feeWei = useMemo(() => {
    try {
      return parseUsdc(oracleFee);
    } catch {
      return 0n;
    }
  }, [oracleFee]);
  const totalWei = stakeWei + feeWei;

  const allowanceQuery = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && isContractConfigured()
      ? [address, CONTRACT_ADDRESS as `0x${string}`]
      : undefined,
    query: { enabled: Boolean(address) && isContractConfigured() },
  });

  const { writeContractAsync } = useWriteContract();

  const approveReceipt = useWaitForTransactionReceipt({
    hash: approveHash ?? undefined,
    query: { enabled: Boolean(approveHash) },
  });
  const createReceipt = useWaitForTransactionReceipt({
    hash: createHash ?? undefined,
    query: { enabled: Boolean(createHash) },
  });

  // After approve receipt confirms, kick off create.
  useEffect(() => {
    if (step !== 'approving') return;
    if (!approveReceipt.data) return;
    void allowanceQuery.refetch();
    void doCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveReceipt.data, step]);

  // After create receipt confirms, decode event + push.
  useEffect(() => {
    if (step !== 'creating') return;
    if (!createReceipt.data) return;
    const logs = createReceipt.data.logs ?? [];
    const createdEvent = parseAbiItem(
      'event CommitmentCreated(uint256 indexed id, address indexed user, address indexed enemy, uint128 stake, uint128 oracleFee, uint64 deadline, string task, string rubric)',
    );
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: [createdEvent],
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'CommitmentCreated') {
          const id = (decoded.args as { id: bigint }).id;
          setStep('done');
          router.push(`/c/${id.toString()}`);
          return;
        }
      } catch {
        // not our event
      }
    }
    // Couldn't find the event — still mark done but stay on page.
    setStep('done');
  }, [createReceipt.data, step, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!isContractConfigured()) {
      setErrorMsg('NEXT_PUBLIC_CONTRACT_ADDRESS is not configured.');
      return;
    }
    if (!address) {
      setErrorMsg('Connect wallet first.');
      return;
    }
    if (!task.trim() || !rubric.trim()) {
      setErrorMsg('Task and rubric are required.');
      return;
    }
    if (!enemyResolved || !isAddress(enemyResolved)) {
      setErrorMsg('Enter a valid enemy address or ENS name.');
      return;
    }
    if (enemyResolved.toLowerCase() === address.toLowerCase()) {
      setErrorMsg('Enemy must not be you.');
      return;
    }
    if (stakeWei <= 0n) {
      setErrorMsg('Stake must be > 0.');
      return;
    }
    if (feeWei <= 0n) {
      setErrorMsg('Oracle fee must be > 0.');
      return;
    }
    if (!deadlineLocal) {
      setErrorMsg('Deadline required.');
      return;
    }
    const deadlineSecs = BigInt(Math.floor(new Date(deadlineLocal).getTime() / 1000));
    if (deadlineSecs <= BigInt(Math.floor(Date.now() / 1000))) {
      setErrorMsg('Deadline must be in the future.');
      return;
    }

    const currentAllowance = (allowanceQuery.data as bigint | undefined) ?? 0n;

    try {
      if (currentAllowance < totalWei) {
        setStep('approving');
        const hash = await writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [CONTRACT_ADDRESS as `0x${string}`, totalWei],
        });
        setApproveHash(hash);
      } else {
        await doCreate();
      }
    } catch (err) {
      setStep('error');
      setErrorMsg((err as Error).message);
    }
  }

  async function doCreate() {
    setErrorMsg(null);
    setStep('creating');
    try {
      const deadlineSecs = BigInt(Math.floor(new Date(deadlineLocal).getTime() / 1000));
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: abi as Abi,
        functionName: 'create',
        args: [enemyResolved, stakeWei, feeWei, deadlineSecs, task, rubric],
      });
      setCreateHash(hash);
    } catch (err) {
      setStep('error');
      setErrorMsg((err as Error).message);
    }
  }

  const busy = step === 'approving' || step === 'creating';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-neutral-300">Task</span>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
          className="rounded border border-neutral-800 bg-neutral-950 p-3 text-neutral-100"
          placeholder="What will you finish?"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-neutral-300">Rubric</span>
        <textarea
          value={rubric}
          onChange={(e) => setRubric(e.target.value)}
          rows={3}
          className="rounded border border-neutral-800 bg-neutral-950 p-3 text-neutral-100"
          placeholder="What would count as irrefutable proof?"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-neutral-300">
          Enemy address <span className="text-red-400">(they get the money if you fail)</span>
        </span>
        <input
          value={enemyInput}
          onChange={(e) => setEnemyInput(e.target.value)}
          className="rounded border border-neutral-800 bg-neutral-950 p-3 font-mono text-neutral-100"
          placeholder="0x… or name.eth"
        />
        {ensLoading && <span className="text-xs text-neutral-500">resolving…</span>}
        {enemyResolved && enemyResolved !== enemyInput.trim() && (
          <span className="font-mono text-xs text-neutral-500">→ {enemyResolved}</span>
        )}
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-neutral-300">Stake (USDC)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            className="rounded border border-neutral-800 bg-neutral-950 p-3 text-neutral-100"
            placeholder="10"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-neutral-300">Oracle fee (USDC)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={oracleFee}
            onChange={(e) => setOracleFee(e.target.value)}
            className="rounded border border-neutral-800 bg-neutral-950 p-3 text-neutral-100"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-neutral-300">Deadline</span>
        <input
          type="datetime-local"
          value={deadlineLocal}
          onChange={(e) => setDeadlineLocal(e.target.value)}
          className="rounded border border-neutral-800 bg-neutral-950 p-3 text-neutral-100"
        />
      </label>

      {errorMsg && (
        <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {errorMsg}
        </p>
      )}

      {step !== 'idle' && step !== 'error' && (
        <div className="rounded border border-neutral-800 bg-neutral-950 p-4 text-sm">
          <StepIndicator step={step} approveHash={approveHash} createHash={createHash} />
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !isContractConfigured()}
        className="rounded bg-neutral-100 px-6 py-3 font-medium text-neutral-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Working…' : 'Commit'}
      </button>

      {!isContractConfigured() && (
        <p className="text-xs text-neutral-500">
          Set <code>NEXT_PUBLIC_CONTRACT_ADDRESS</code> in <code>.env.local</code> to enable write actions.
        </p>
      )}
    </form>
  );
}

function StepIndicator({
  step,
  approveHash,
  createHash,
}: {
  step: Step;
  approveHash: Hex | null;
  createHash: Hex | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <StepRow
        active={step === 'approving'}
        done={step === 'creating' || step === 'done'}
        label="Approving USDC"
        hash={approveHash}
      />
      <StepRow
        active={step === 'creating'}
        done={step === 'done'}
        label="Creating commitment"
        hash={createHash}
      />
    </div>
  );
}

function StepRow({
  active,
  done,
  label,
  hash,
}: {
  active: boolean;
  done: boolean;
  label: string;
  hash: Hex | null;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={done ? 'text-green-400' : active ? 'text-neutral-100' : 'text-neutral-600'}>
        {done ? '✓ ' : active ? '… ' : '  '}{label}
      </span>
      {hash && (
        <a
          href={etherscanTxUrl(hash, CHAIN_ID)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-neutral-400 underline"
        >
          tx
        </a>
      )}
    </div>
  );
}
