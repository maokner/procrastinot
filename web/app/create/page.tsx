'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { decodeEventLog, parseAbiItem, type Abi, type Hex } from 'viem';
import {
  CONTRACT_ADDRESS,
  CHAIN_ID,
  USDC_ADDRESS,
  abi,
  erc20Abi,
  isContractConfigured,
} from '@/lib/contract';
import { parseUsdc, etherscanTxUrl } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase';
import { ConnectGate } from '@/components/ConnectGate';

type Step = 'idle' | 'approving' | 'creating' | 'done' | 'error';

type Suggestion = { username: string; display_name: string | null };

export default function CreatePage() {
  return (
    <main className="pn-page max-w-4xl">
      <Link href="/my" className="pn-backlink mb-5">← Back to my commitments</Link>
      <div className="mb-10 border-b-4 border-black pb-6">
        <p className="pn-kicker mb-3">Draft</p>
        <h1 className="pn-title mb-4 text-5xl sm:text-6xl">New commitment</h1>
        <p className="pn-copy max-w-2xl">
          Fill in one clear task, one grading rubric, and one username enemy. Then
          approve the spend and lock the terms.
        </p>
      </div>
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
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [stake, setStake] = useState('');
  const oracleFee = '0.1';
  const [deadlineLocal, setDeadlineLocal] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [approveHash, setApproveHash] = useState<Hex | null>(null);
  const [createHash, setCreateHash] = useState<Hex | null>(null);
  const sugRef = useRef<HTMLDivElement>(null);

  const normalizedUsername = useMemo(() => {
    const v = enemyInput.trim().replace(/^@/, '').toLowerCase();
    return /^[a-z0-9_]{1,20}$/.test(v) ? v : '';
  }, [enemyInput]);

  // Fetch username suggestions (prefix match) as user types.
  useEffect(() => {
    if (!normalizedUsername) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/users/search?q=${encodeURIComponent(normalizedUsername)}`,
        );
        if (!r.ok) return;
        const list = (await r.json()) as Suggestion[];
        if (!cancelled) setSuggestions(list);
      } catch {
        /* ignore */
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [normalizedUsername]);

  // Resolve the selected/typed username → wallet address via RPC.
  useEffect(() => {
    if (!normalizedUsername) {
      setEnemyResolved(null);
      setResolveError(null);
      return;
    }
    let cancelled = false;
    setResolveError(null);
    setEnemyResolved(null);
    (async () => {
      const sb = supabaseBrowser();
      const { data, error } = await sb.rpc('resolve_username', {
        u: normalizedUsername,
      } as never);
      if (cancelled) return;
      if (error) {
        setResolveError(error.message);
        return;
      }
      const row = (data as { address: string; chain_id: number }[] | null)?.[0];
      if (!row) {
        setResolveError(
          "That user hasn't linked a wallet yet. Ask them to finish onboarding.",
        );
        return;
      }
      setEnemyResolved(row.address as `0x${string}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [normalizedUsername]);

  // Close suggestions on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!sugRef.current) return;
      if (!sugRef.current.contains(e.target as Node)) setShowSug(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const stakeWei = useMemo(() => {
    try { return parseUsdc(stake); } catch { return 0n; }
  }, [stake]);
  const feeWei = useMemo(() => {
    try { return parseUsdc(oracleFee); } catch { return 0n; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const totalWei = stakeWei + feeWei;

  const allowanceQuery = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args:
      address && isContractConfigured()
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

  useEffect(() => {
    if (step !== 'approving') return;
    if (!approveReceipt.data) return;
    void allowanceQuery.refetch();
    void doCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveReceipt.data, step]);

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
        /* not our event */
      }
    }
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
    if (!enemyResolved) {
      setErrorMsg('Pick a valid @username enemy.');
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
        args: [enemyResolved!, stakeWei, feeWei, deadlineSecs, task, rubric],
      });
      setCreateHash(hash);
    } catch (err) {
      setStep('error');
      setErrorMsg((err as Error).message);
    }
  }

  const busy = step === 'approving' || step === 'creating';

  return (
    <form onSubmit={handleSubmit} className="pn-panel flex flex-col gap-5 p-6 md:p-8">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-[var(--ink-1)]">Task</span>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
          className="pn-textarea"
          placeholder="What will you finish?"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-[var(--ink-1)]">Rubric</span>
        <textarea
          value={rubric}
          onChange={(e) => setRubric(e.target.value)}
          rows={3}
          className="pn-textarea"
          placeholder="What would count as irrefutable proof?"
        />
      </label>

      <div className="flex flex-col gap-1.5" ref={sugRef}>
        <span className="text-sm text-[var(--ink-1)]">
          Enemy <span className="text-[var(--danger)]">(they get the money if you fail)</span>
        </span>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-2)]">
            @
          </span>
          <input
            value={enemyInput.replace(/^@/, '')}
            onChange={(e) => {
              setEnemyInput(e.target.value);
              setShowSug(true);
            }}
            onFocus={() => setShowSug(true)}
            autoComplete="off"
            spellCheck={false}
            className="pn-input font-mono"
            placeholder="oliver"
            style={{ paddingLeft: '1.75rem' }}
          />
          {showSug && suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded-xl border border-[var(--line)] bg-white py-1 text-sm shadow-lg">
              {suggestions.map((s) => (
                <li key={s.username}>
                  <button
                    type="button"
                    onClick={() => {
                      setEnemyInput(s.username);
                      setShowSug(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[var(--accent-soft)]"
                  >
                    <span className="font-mono text-[var(--ink-0)]">@{s.username}</span>
                    {s.display_name && (
                      <span className="text-xs text-[var(--ink-2)]">{s.display_name}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {enemyResolved && (
          <span className="font-mono text-xs text-[var(--ink-2)]">
            @{normalizedUsername} → {enemyResolved.slice(0, 6)}…{enemyResolved.slice(-4)}
          </span>
        )}
        {resolveError && (
          <span className="text-xs text-[var(--danger)]">{resolveError}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-[var(--ink-1)]">Stake (USDC)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            className="pn-input"
            placeholder="10"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-[var(--ink-1)]">Deadline</span>
        <input
          type="datetime-local"
          value={deadlineLocal}
          onChange={(e) => setDeadlineLocal(e.target.value)}
          className="pn-input"
        />
      </label>

      {errorMsg && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,var(--line))] bg-[color-mix(in_srgb,var(--danger)_10%,white)] p-3 text-sm text-[var(--danger)]">
          {errorMsg}
        </p>
      )}

      {step !== 'idle' && step !== 'error' && (
        <div className="rounded-xl border border-[var(--line)] bg-white/60 p-4 text-sm">
          <StepIndicator step={step} approveHash={approveHash} createHash={createHash} />
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !isContractConfigured() || !enemyResolved}
        className="pn-btn pn-btn-primary px-6 py-3"
      >
        {busy ? 'Working…' : 'Commit'}
      </button>

      {!isContractConfigured() && (
        <p className="text-xs text-[var(--ink-2)]">
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
      <span className={done ? 'text-[var(--success)]' : active ? 'text-[var(--ink-0)]' : 'text-[var(--ink-2)]'}>
        {done ? '✓ ' : active ? '… ' : '  '}{label}
      </span>
      {hash && (
        <a
          href={etherscanTxUrl(hash, CHAIN_ID)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[var(--ink-2)] underline"
        >
          tx
        </a>
      )}
    </div>
  );
}
