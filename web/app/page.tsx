import Link from 'next/link';
import { ConnectButtonLazy as ConnectButton } from '@/components/ConnectButtonLazy';

const HERO_ART =
  'https://images.unsplash.com/photo-1775513999069-318837c9b21b?auto=format&fit=crop&w=2200&q=80';

export default function LandingPage() {
  return (
    <main>
      <section className="relative min-h-[calc(100svh-var(--header-h))] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={HERO_ART}
          alt="Sunlit desk by a window with plants."
          className="pn-breathe absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(105deg,rgba(20,18,15,0.68)_0%,rgba(20,18,15,0.4)_45%,rgba(20,18,15,0.2)_100%)]" />

        <div className="relative mx-auto flex min-h-[calc(100svh-var(--header-h))] w-full max-w-6xl items-end px-6 pb-10 pt-10 md:items-center md:pb-14">
          <div className="max-w-2xl text-[#f9f3e7]">
            <p className="pn-rise-1 pn-title mb-3 text-4xl leading-none tracking-tight sm:text-6xl">
              PROCRASTINOT
            </p>
            <h1 className="pn-rise-2 mb-4 text-3xl font-semibold tracking-tight sm:text-5xl">
              Commit in public.
              <br />
              Finish on time.
            </h1>
            <p className="pn-rise-3 mb-8 max-w-xl text-base text-[#f3ead8] sm:text-lg">
              Write the task, set the stake, and pick your enemy wallet. If you miss the
              deadline, they get paid automatically.
            </p>
            <div className="pn-rise-3 flex flex-wrap items-center gap-3">
              <Link href="/create" className="pn-btn pn-btn-primary px-6 py-3 text-base">
                Start a commitment
              </Link>
              <Link
                href="/my"
                className="pn-btn border border-[#e3d7c4] bg-[rgba(255,255,255,0.16)] px-6 py-3 text-base text-[#fff6e8] hover:bg-[rgba(255,255,255,0.24)]"
              >
                View my commitments
              </Link>
            </div>
            <div className="pn-rise-3 mt-5">
              <ConnectButton />
            </div>
          </div>
        </div>
      </section>

      <section className="pn-page grid gap-12 py-16 md:grid-cols-[1.1fr_1fr] md:py-20">
        <div>
          <p className="pn-kicker mb-3">How It Works</p>
          <h2 className="pn-title mb-4 text-4xl">One clear consequence.</h2>
          <p className="pn-copy max-w-lg">
            You only track one promise at a time, with one grading rubric and one person
            who benefits if you fail.
          </p>
        </div>
        <ol className="space-y-6">
          <li>
            <p className="pn-kicker mb-1">01</p>
            <h3 className="mb-1 text-xl font-semibold">Define the deliverable</h3>
            <p className="pn-copy">Describe exactly what “done” means so grading is obvious.</p>
          </li>
          <li>
            <p className="pn-kicker mb-1">02</p>
            <h3 className="mb-1 text-xl font-semibold">Set money and deadline</h3>
            <p className="pn-copy">Stake your USDC and choose when the proof must be in.</p>
          </li>
          <li>
            <p className="pn-kicker mb-1">03</p>
            <h3 className="mb-1 text-xl font-semibold">Submit proof or forfeit</h3>
            <p className="pn-copy">The oracle judges evidence. Late means the enemy can claim.</p>
          </li>
        </ol>
      </section>

      <section className="border-y border-[var(--line)] bg-[rgba(255,255,255,0.45)]">
        <div className="pn-page py-16">
          <p className="pn-kicker mb-3">Navigation</p>
          <h2 className="pn-title mb-4 text-4xl">No dead ends.</h2>
          <p className="pn-copy mb-8 max-w-2xl">
            Every core screen has a back path and a next action: create from Home/My,
            review in Inbox, resolve in Commitment detail.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/create" className="pn-btn pn-btn-secondary">
              Go to Create
            </Link>
            <Link href="/my" className="pn-btn pn-btn-secondary">
              Go to My
            </Link>
            <Link href="/inbox" className="pn-btn pn-btn-secondary">
              Go to Inbox
            </Link>
          </div>
        </div>
      </section>

      <section className="pn-page py-14">
        <p className="text-sm text-[var(--ink-2)]">
          Hero art inspiration: <Link href="https://unsplash.com/photos/desk-with-plants-by-a-sunlit-window-t6vwJ1WBH8g" className="underline">Andrii Solok on Unsplash</Link>.
        </p>
      </section>
    </main>
  );
}
