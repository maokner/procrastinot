import Link from 'next/link';
import { ConnectButtonLazy as ConnectButton } from '@/components/ConnectButtonLazy';

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <Link href="/" prefetch className="font-mono text-sm uppercase tracking-widest">
          procrastinot
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/my"
            prefetch
            className="text-sm text-neutral-400 hover:text-neutral-100"
          >
            My
          </Link>
          <Link
            href="/inbox"
            prefetch
            className="text-sm text-neutral-400 hover:text-neutral-100"
          >
            Inbox
          </Link>
          <ConnectButton />
        </div>
      </header>

      <section className="flex flex-1 flex-col justify-center gap-6 py-24">
        <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
          Commit. Or pay your enemy.
        </h1>
        <p className="max-w-xl text-lg text-neutral-400">
          Procrastinot locks USDC until you prove you finished the task. Miss
          the deadline — it goes to a wallet you&apos;ll hate losing to.
        </p>

        <ol className="mt-4 grid gap-4 text-sm text-neutral-300 sm:grid-cols-3">
          <Step
            n={1}
            title="Pick your task"
            body="Write what you'll do and what proof looks like. Set a deadline."
          />
          <Step
            n={2}
            title="Pick your enemy"
            body="Autocomplete @username. They&apos;re notified the moment you commit."
          />
          <Step
            n={3}
            title="Ship — or pay"
            body="Submit proof. An oracle grades it. Miss the deadline, they claim the stake."
          />
        </ol>

        <div className="mt-6 flex items-center gap-4">
          <Link
            href="/create"
            prefetch
            className="inline-block rounded bg-neutral-100 px-6 py-3 text-base font-medium text-neutral-950 hover:bg-white"
          >
            Create a commitment
          </Link>
          <Link
            href="/my"
            prefetch
            className="text-sm text-neutral-400 hover:text-neutral-100"
          >
            or view yours →
          </Link>
        </div>
      </section>

      <footer className="border-t border-neutral-900 pt-6 text-xs text-neutral-600">
        Sepolia testnet. USDC, 6 decimals. Max 3 attempts per commitment.
      </footer>
    </main>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="rounded border border-neutral-900 bg-neutral-950 p-4">
      <div className="mb-2 text-xs font-mono text-neutral-500">0{n}</div>
      <div className="mb-1 font-semibold text-neutral-100">{title}</div>
      <div className="text-neutral-400">{body}</div>
    </li>
  );
}
