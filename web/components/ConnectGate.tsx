'use client';

import { ReactNode } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export function ConnectGate({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-lg border border-neutral-800 bg-neutral-950 p-6">
        <p className="text-neutral-300">Connect your wallet to continue.</p>
        <ConnectButton />
      </div>
    );
  }

  if (chainId !== sepolia.id) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-lg border border-red-900 bg-neutral-950 p-6">
        <p className="text-red-400">Wrong network. Procrastinot runs on Sepolia.</p>
        <button
          type="button"
          onClick={() => switchChain({ chainId: sepolia.id })}
          disabled={isPending}
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-900 disabled:opacity-50"
        >
          {isPending ? 'Switching…' : 'Switch to Sepolia'}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
