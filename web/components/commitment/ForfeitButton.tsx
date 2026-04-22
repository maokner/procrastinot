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
 * - variant='forfeit' (creator-side, after deadline): outline emphasis.
 * - variant='claim'   (enemy-side, after deadline):   solid emphasis.
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
      ? 'pn-btn pn-btn-danger'
      : 'pn-btn pn-btn-success';

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={go}
        disabled={disabled || busy}
        className={`${base}`}
      >
        {busy ? (rx.isLoading ? 'Confirming…' : 'Signing…') : label}
      </button>
      {err && (
        <p className="rounded-xl border border-[color-mix(in_srgb,var(--danger)_35%,var(--line))] bg-[color-mix(in_srgb,var(--danger)_10%,white)] p-3 text-sm text-[var(--danger)]">
          {err}
        </p>
      )}
      {txHash && (
        <a
          href={etherscanTxUrl(txHash, CHAIN_ID)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[var(--ink-2)] underline"
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
