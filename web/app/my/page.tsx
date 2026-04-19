'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, usePublicClient } from 'wagmi';
import { decodeEventLog, parseAbiItem, type Hex } from 'viem';
import { CONTRACT_ADDRESS, isContractConfigured } from '@/lib/contract';
import { formatUsdc } from '@/lib/format';
import { ConnectGate } from '@/components/ConnectGate';

const BLOCK_CHUNK = 50_000n;

type Row = {
  id: bigint;
  enemy: `0x${string}`;
  stake: bigint;
  deadline: bigint;
  task: string;
  blockNumber: bigint;
};

export default function MyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="font-mono text-sm uppercase tracking-widest">
          procrastinot
        </Link>
        <ConnectButton />
      </header>
      <h1 className="mb-6 text-2xl font-semibold">My commitments</h1>
      <ConnectGate>
        <MyList />
      </ConnectGate>
    </main>
  );
}

function MyList() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient || !address || !isContractConfigured()) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const latest = await publicClient!.getBlockNumber();
        const event = parseAbiItem(
          'event CommitmentCreated(uint256 indexed id, address indexed user, address indexed enemy, uint128 stake, uint128 oracleFee, uint64 deadline, string task, string rubric)',
        );
        const acc: Row[] = [];
        // Iterate from latest back to 0 in 50k chunks.
        let end = latest;
        const zero = 0n;
        while (end > zero) {
          if (cancelled) return;
          const start = end > BLOCK_CHUNK ? end - BLOCK_CHUNK + 1n : 0n;
          const logs = await publicClient!.getLogs({
            address: CONTRACT_ADDRESS as `0x${string}`,
            event,
            args: { user: address },
            fromBlock: start,
            toBlock: end,
          });
          for (const log of logs) {
            try {
              const decoded = decodeEventLog({
                abi: [event],
                data: log.data,
                topics: log.topics,
              });
              const a = decoded.args as {
                id: bigint;
                enemy: `0x${string}`;
                stake: bigint;
                deadline: bigint;
                task: string;
              };
              acc.push({
                id: a.id,
                enemy: a.enemy,
                stake: a.stake,
                deadline: a.deadline,
                task: a.task,
                blockNumber: log.blockNumber ?? 0n,
              });
            } catch {
              /* ignore */
            }
          }
          if (start === 0n) break;
          end = start - 1n;
        }
        if (cancelled) return;
        acc.sort((a, b) => Number(b.blockNumber - a.blockNumber));
        setRows(acc);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [publicClient, address]);

  if (!isContractConfigured()) {
    return (
      <p className="text-sm text-neutral-500">
        Set <code>NEXT_PUBLIC_CONTRACT_ADDRESS</code> in <code>.env.local</code> to list commitments.
      </p>
    );
  }

  if (loading) return <p className="text-neutral-400">Scanning logs…</p>;
  if (err) return <p className="text-red-400">Error: {err}</p>;
  if (rows.length === 0)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-neutral-400">No commitments yet.</p>
        <Link
          href="/create"
          className="inline-block self-start rounded bg-neutral-100 px-4 py-2 text-neutral-950 hover:bg-white"
        >
          Create one
        </Link>
      </div>
    );

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.id.toString()} className="rounded border border-neutral-800 bg-neutral-950 p-4">
          <Link href={`/c/${r.id.toString()}`} className="flex flex-col gap-1 hover:opacity-90">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">#{r.id.toString()}</span>
              <span className="text-sm text-neutral-400">{formatUsdc(r.stake)} USDC</span>
            </div>
            <p className="line-clamp-2 text-sm text-neutral-300">{r.task}</p>
            <p className="font-mono text-xs text-red-300/80">enemy {shorten(r.enemy)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function shorten(addr: Hex | string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
