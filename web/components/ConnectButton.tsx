'use client';

import { useEffect, useRef, useState } from 'react';
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from 'wagmi';
import { sepolia } from 'wagmi/chains';
import type { CreateConnectorFn } from 'wagmi';

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Lean connect button. No RainbowKit. Uses wagmi hooks directly.
 * Three visual states:
 *   1. Disconnected: "Connect wallet" (uses the already-configured injected connector).
 *      An optional "More wallets" reveals a lazy-loaded WalletConnect option.
 *   2. Wrong chain: "Switch to Sepolia".
 *   3. Connected on Sepolia: shortened address + dropdown with "Disconnect".
 */
export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: connecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  const [menuOpen, setMenuOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [wcConnector, setWcConnector] = useState<CreateConnectorFn | null>(null);
  const [wcLoading, setWcLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close menu on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function loadWalletConnect() {
    const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID;
    if (!projectId) return null;
    setWcLoading(true);
    try {
      const mod = await import('wagmi/connectors');
      const connector = mod.walletConnect({ projectId, showQrModal: true });
      setWcConnector(() => connector);
      return connector;
    } finally {
      setWcLoading(false);
    }
  }

  // Disconnected state
  if (!isConnected) {
    const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0];
    return (
      <div className="relative flex flex-col items-end gap-1" ref={ref}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => injected && connect({ connector: injected })}
            disabled={connecting || !injected}
            className="rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white disabled:opacity-60"
          >
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
          {process.env.NEXT_PUBLIC_WALLETCONNECT_ID && (
            <button
              type="button"
              onClick={async () => {
                let c = wcConnector;
                if (!c) c = await loadWalletConnect();
                if (c) connect({ connector: c });
              }}
              disabled={wcLoading || connecting}
              className="rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300 hover:bg-neutral-900 disabled:opacity-50"
              title="WalletConnect (mobile / QR)"
            >
              {wcLoading ? 'Loading…' : 'More'}
            </button>
          )}
        </div>
        {connectError && (
          <span className="text-xs text-red-400">{connectError.message}</span>
        )}
      </div>
    );
  }

  // Wrong chain
  if (chainId !== sepolia.id) {
    return (
      <button
        type="button"
        onClick={() => switchChain({ chainId: sepolia.id })}
        disabled={switching}
        className="rounded border border-red-800 bg-red-950/40 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-950 disabled:opacity-60"
      >
        {switching ? 'Switching…' : 'Switch to Sepolia'}
      </button>
    );
  }

  // Connected + correct chain
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2 rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm font-mono hover:bg-neutral-900"
      >
        <span className="inline-block h-2 w-2 rounded-full bg-green-400" />
        {address ? shorten(address) : ''}
        <svg width="10" height="10" viewBox="0 0 12 12" className="opacity-60">
          <path fill="currentColor" d="M2 4 L6 8 L10 4 Z" />
        </svg>
      </button>
      {menuOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded border border-neutral-800 bg-neutral-950 py-1 text-sm shadow-lg">
          <button
            type="button"
            onClick={() => {
              disconnect();
              setMenuOpen(false);
            }}
            className="block w-full px-3 py-2 text-left hover:bg-neutral-900"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export default ConnectButton;
