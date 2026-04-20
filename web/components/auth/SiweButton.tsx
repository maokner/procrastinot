'use client';

/**
 * SIWE "verify ownership" button.
 *
 * Flow:
 * 1. Ensure wallet connected (wagmi `useAccount` + injected connector).
 * 2. GET /api/siwe/nonce → { nonce }.
 * 3. Build a SiweMessage, sign it via `useSignMessage`.
 * 4. POST { message, signature } to /api/siwe/verify.
 *
 * Deliberately NOT using RainbowKit — Agent D is replacing the connect
 * experience with a lean in-house button. We use the bare wagmi hooks so
 * our bundle doesn't grow.
 */

import { useCallback, useMemo, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { SiweMessage } from 'siwe';

const SEPOLIA = 11155111;

export function SiweButton({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void;
  onError?: (msg: string) => void;
}) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: connectPending } = useConnect();
  const { signMessageAsync, isPending: signPending } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Prefer an already-registered injected connector if the providers list
  // includes one (e.g. MetaMask); otherwise fall back to a fresh `injected()`.
  const injectedConnector = useMemo(
    () => connectors.find((c) => c.type === 'injected') ?? injected(),
    [connectors],
  );

  const handleConnect = useCallback(() => {
    setErr(null);
    // `connect` accepts a created connector instance or one from the config.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    connect({ connector: injectedConnector as any });
  }, [connect, injectedConnector]);

  const handleVerify = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setErr(null);
    try {
      // 1. Nonce.
      const nRes = await fetch('/api/siwe/nonce', { method: 'GET', credentials: 'include' });
      if (!nRes.ok) throw new Error(`nonce request failed (${nRes.status})`);
      const { nonce } = (await nRes.json()) as { nonce: string };

      // 2. Build + sign.
      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: 'Link this wallet to your Procrastinot account.',
        uri: window.location.origin,
        version: '1',
        chainId: SEPOLIA,
        nonce,
        issuedAt: new Date().toISOString(),
      });
      const prepared = message.prepareMessage();
      const signature = await signMessageAsync({ message: prepared });

      // 3. Verify server-side.
      const vRes = await fetch('/api/siwe/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: prepared, signature }),
      });
      if (!vRes.ok) {
        const { error } = (await vRes.json().catch(() => ({ error: 'verify failed' }))) as {
          error?: string;
        };
        throw new Error(error ?? 'verify failed');
      }
      onSuccess?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unexpected error';
      setErr(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }, [address, signMessageAsync, onSuccess, onError]);

  return (
    <div className="flex flex-col gap-3">
      {!isConnected ? (
        <button
          type="button"
          onClick={handleConnect}
          disabled={connectPending}
          className="w-fit rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white disabled:opacity-50"
        >
          {connectPending ? 'Opening wallet…' : 'Connect wallet'}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs text-neutral-400">
            Connected: {address}
          </p>
          <button
            type="button"
            onClick={handleVerify}
            disabled={busy || signPending}
            className="w-fit rounded bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white disabled:opacity-50"
          >
            {busy || signPending ? 'Signing…' : 'Verify ownership'}
          </button>
        </div>
      )}
      {err ? <p className="text-xs text-red-400">{err}</p> : null}
    </div>
  );
}
