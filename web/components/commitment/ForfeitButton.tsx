'use client';

import { useState } from 'react';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import type { Abi, Hex } from 'viem';
import { procrastinotAbi } from '@procrastinot/abi';
import { CONTRACT_ADDRESS, CHAIN_ID } from '@/lib/contract';
import { etherscanTxUrl } from '@/lib/format';

const abi = procrastinotAbi as unknown as Abi;

type Variant = 'forfeit' | 'claim';

/**
 * Unified button for the `forfeit(id)` contract call.
 * - variant='forfeit' (creator-side, after deadline): red, "Forfeit to enemy".
 * - variant='claim'   (enemy-side, after deadline):   green, "Claim X USDC".
 * Both call the same function — the contract pays the enemy (stake) and
 * sends the remaining oracleFee to the operator (v2 semantics).
 */
export function ForfeitOrClaimButton({
  id,
  variant,
  label,
  disabled,
}: {
  id: bigint;
  variant: Variant;
  label: string;
  disabled?: boolean;
}) {
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { writeContractAsync, isPending: writing } = useWriteContract();
  const rx = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    query: { enabled: Boolean(txHash) },
  });

  async function go() {
    setErr(null);
    if (!CONTRACT_ADDRESS) {
      setErr('Contract not configured.');
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi,
        functionName: 'forfeit',
        args: [id],
      });
      setTxHash(hash);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const busy = writing || rx.isLoading;
  const base =
    variant === 'forfeit'
      ? 'border border-red-800 bg-red-950/40 text-red-200 hover:bg-red-950'
      : 'bg-green-600 text-white hover:bg-green-500';

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={go}
        disabled={disabled || busy}
        className={`rounded px-4 py-2 font-medium disabled:opacity-50 ${base}`}
      >
        {busy ? (rx.isLoading ? 'Confirming…' : 'Signing…') : label}
      </button>
      {err && (
        <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {err}
        </p>
      )}
      {txHash && (
        <a
          href={etherscanTxUrl(txHash, CHAIN_ID)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-neutral-400 underline"
        >
          {rx.isSuccess ? '✓ confirmed' : '… confirming'} (etherscan)
        </a>
      )}
    </div>
  );
}

export function ForfeitButton(props: { id: bigint; disabled?: boolean }) {
  return <ForfeitOrClaimButton {...props} variant="forfeit" label="Forfeit to enemy" />;
}

export function ClaimButton(props: { id: bigint; label: string; disabled?: boolean }) {
  return <ForfeitOrClaimButton id={props.id} disabled={props.disabled} variant="claim" label={props.label} />;
}
