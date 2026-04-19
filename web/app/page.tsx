'use client';

import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="font-mono text-sm uppercase tracking-widest">
          procrastinot
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/my" className="text-sm text-neutral-400 hover:text-neutral-100">
            My commitments
          </Link>
          <ConnectButton />
        </div>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-8 py-24">
        <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
          Commit. Or pay your enemy.
        </h1>
        <p className="max-w-xl text-lg text-neutral-400">
          Procrastinot locks USDC until you prove you finished the task. Miss
          the deadline — it goes to a wallet you&apos;ll hate losing to.
        </p>
        <div>
          <Link
            href="/create"
            className="inline-block rounded bg-neutral-100 px-6 py-3 text-base font-medium text-neutral-950 hover:bg-white"
          >
            Create a commitment
          </Link>
        </div>
      </section>

      <footer className="border-t border-neutral-900 pt-6 text-xs text-neutral-600">
        Sepolia testnet. USDC, 6 decimals. Max 3 attempts per commitment.
      </footer>
    </main>
  );
}
