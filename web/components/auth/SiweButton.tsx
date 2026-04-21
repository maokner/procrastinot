'use client';

/**
 * SIWE "verify ownership" button.
 *
 * Flow:
 * 1. Ensure wallet connected (wagmi `useAccount` + injected connector).
 * 2. POST /api/siwe/nonce with { address } → { nonce }.
 * 3. Build a SiweMessage, sign it via `useSignMessage`.
 * 4. POST { message, signature } to /api/siwe/verify.
 * 5. Read { needsUsername } and route to /onboarding or the app.
 *
 * Deliberately NOT using RainbowKit — Agent D is replacing the connect
 * experience with a lean in-house button. We use the bare wagmi hooks so
 * our bundle doesn't grow.
 */

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { SiweMessage } from 'siwe';

const SEPOLIA = 11155111;

export type SiweVerifyResult = {
  needsUsername: boolean;
};

function preferredOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) return window.location.origin;
  try {
    return new URL(configured).origin;
  } catch {
    return window.location.origin;
  }
}

function safeNextPath(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

export function SiweButton({
  onSuccess,
  onError,
  nextPath,
}: {
  onSuccess?: (result: SiweVerifyResult) => void;
  onError?: (msg: string) => void;
  nextPath?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
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
      const nRes = await fetch('/api/siwe/nonce', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ address }),
      });
      if (!nRes.ok) throw new Error(`nonce request failed (${nRes.status})`);
      const { nonce } = (await nRes.json()) as { nonce: string };

      // 2. Build + sign.
      const origin = preferredOrigin();
      const message = new SiweMessage({
        domain: new URL(origin).host,
        address,
        statement: 'Sign in to Procrastinot with this wallet.',
        uri: origin,
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
      const result = (await vRes.json()) as SiweVerifyResult;
      onSuccess?.(result);

      if (!onSuccess) {
        const next = safeNextPath(nextPath ?? searchParams.get('next'));
        router.push(result.needsUsername ? '/onboarding' : next ?? '/my');
        router.refresh();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unexpected error';
      setErr(msg);
      onError?.(msg);
    } finally {
      setBusy(false);
    }
  }, [address, nextPath, onError, onSuccess, router, searchParams, signMessageAsync]);

  return (
    <div className="flex flex-col gap-3">
      {!isConnected ? (
        <button
          type="button"
          onClick={handleConnect}
          disabled={connectPending}
          className="pn-btn pn-btn-primary w-fit text-sm"
        >
          {connectPending ? 'Opening wallet…' : 'Connect wallet'}
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs text-[var(--ink-2)]">
            Connected: {address}
          </p>
          <button
            type="button"
            onClick={handleVerify}
            disabled={busy || signPending}
            className="pn-btn pn-btn-primary w-fit text-sm"
          >
            {busy || signPending ? 'Signing…' : 'Verify ownership'}
          </button>
        </div>
      )}
      {err ? <p className="text-xs text-[var(--danger)]">{err}</p> : null}
    </div>
  );
}
