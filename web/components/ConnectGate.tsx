'use client';

import { ReactNode } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { ConnectButton } from './ConnectButton';

export function ConnectGate({ children }: { children: ReactNode }) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) {
    return (
      <div className="pn-panel flex flex-col items-start gap-4 rounded-2xl p-6">
        <p className="text-[var(--ink-1)]">Connect your wallet to continue.</p>
        <ConnectButton />
      </div>
    );
  }

  if (chainId !== sepolia.id) {
    return (
      <div className="pn-panel flex flex-col items-start gap-4 rounded-2xl p-6">
        <p className="text-[var(--danger)]">Wrong network. Procrastinot runs on Sepolia.</p>
        <button
          type="button"
          onClick={() => switchChain({ chainId: sepolia.id })}
          disabled={isPending}
          className="pn-btn pn-btn-secondary text-sm"
        >
          {isPending ? 'Switching…' : 'Switch to Sepolia'}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
