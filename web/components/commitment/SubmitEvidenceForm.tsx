'use client';

import { useState } from 'react';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import type { Abi, Hex } from 'viem';
import { procrastinotAbi } from '@procrastinot/abi';
import { CONTRACT_ADDRESS, CHAIN_ID } from '@/lib/contract';
import { toEvidenceURI, etherscanTxUrl } from '@/lib/format';

const abi = procrastinotAbi as unknown as Abi;

export function SubmitEvidenceForm({ id }: { id: bigint }) {
  const [evidence, setEvidence] = useState('');
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { writeContractAsync, isPending: writing } = useWriteContract();
  const rx = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    query: { enabled: Boolean(txHash) },
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!evidence.trim()) {
      setErr('Evidence cannot be empty.');
      return;
    }
    if (!CONTRACT_ADDRESS) {
      setErr('Contract not configured.');
      return;
    }
    try {
      const uri = toEvidenceURI(evidence);
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi,
        functionName: 'requestVerdict',
        args: [id, uri],
      });
      setTxHash(hash);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-3 rounded border border-neutral-800 bg-neutral-950 p-4"
    >
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
        disabled={writing || rx.isLoading}
        className="self-start rounded bg-neutral-100 px-4 py-2 font-medium text-neutral-950 hover:bg-white disabled:opacity-50"
      >
        {writing ? 'Signing…' : rx.isLoading ? 'Confirming…' : 'Submit evidence'}
      </button>
      {err && (
        <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {err}
        </p>
      )}
      {txHash && (
        <div className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-950 p-3 text-sm">
          <span>{rx.isSuccess ? '✓ submitted' : '… submitting'}</span>
          <a
            href={etherscanTxUrl(txHash, CHAIN_ID)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-neutral-400 underline"
          >
            etherscan
          </a>
        </div>
      )}
    </form>
  );
}
