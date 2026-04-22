import Link from 'next/link';
import { ConnectButtonLazy as ConnectButton } from '@/components/ConnectButtonLazy';
import { HeroFieldCanvas } from '@/components/landing/HeroFieldCanvas';

const PROCESS = [
  {
    numeral: '01',
    title: 'Write the commitment',
    copy:
      'Set one task, one deadline, one stake, and one person who receives the funds if you fail.',
  },
  {
    numeral: '02',
    title: 'Work against the clock',
    copy:
      'The timer, the rules, and the stake stay visible so there is no room to quietly renegotiate with yourself.',
  },
  {
    numeral: '03',
    title: 'Submit proof or pay',
    copy:
      'Upload evidence before the deadline. If you miss, the transfer goes where you said it should.',
  },
];

const PRINCIPLES = [
  {
    label: 'Real stakes',
    copy: 'You choose what you risk up front, so the deadline has weight from the start.',
  },
  {
    label: 'Clear terms',
    copy: 'The task, deadline, and payout target are fixed before the timer starts.',
  },
  {
    label: 'Clean outcome',
    copy: 'When time runs out, it resolves to submitted proof or a transfer. Nothing stays vague.',
  },
];

export default function LandingPage() {
  return (
    <main>
      <section className="relative min-h-[calc(100svh-var(--header-h))] overflow-hidden border-b-4 border-black bg-[var(--bg-0)]">
        <div className="pn-home-grid" />
        <div className="pn-hero-canvas-shell">
          <div className="pn-hero-canvas">
            <HeroFieldCanvas />
          </div>
        </div>

        <div className="relative z-10 mx-auto w-[var(--container)] px-0 pb-10 pt-14 lg:pt-20">
          <div className="pn-ui mb-8 flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-2)]">
            <span className="border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-[var(--bg-0)]">
              Late Edition
            </span>
            <span>Vol. 1</span>
            <span>|</span>
            <span>April 22, 2026</span>
            <span>|</span>
            <span>West Coast Desk</span>
          </div>

          <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
            <div className="pn-rise-1 lg:col-span-8">
              <div className="border-t-4 border-black pt-6">
                <p className="pn-kicker mb-4 text-[var(--accent)]">Front Page Lead</p>
                <h1 className="pn-title max-w-5xl text-[clamp(4rem,10vw,8rem)] leading-[0.9] tracking-[-0.05em]">
                  Miss the deadline.
                  <br />
                  Print a win
                  <br />
                  for your enemy.
                </h1>
                <p className="pn-copy mt-6 max-w-2xl text-justify text-lg lg:text-xl">
                  Procrastinot turns the promise into a published object: one task, one
                  rubric, one visible clock, and one person who profits if the page goes
                  to print without your proof.
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <Link href="/create" className="pn-btn pn-btn-primary">
                    Start a commitment
                  </Link>
                  <Link href="/my" className="pn-btn pn-btn-secondary">
                    Read the ledger
                  </Link>
                </div>
              </div>
            </div>

            <aside className="pn-rise-2 grid gap-0 lg:col-span-4">
              <div className="border border-black bg-[var(--bg-0)] p-6">
                <p className="pn-kicker mb-3">Edition Metadata</p>
                <div className="grid gap-4 text-sm">
                  <InfoRow label="Sector" value="Deadline Enforcement" />
                  <InfoRow label="Asset" value="USDC stake" />
                  <InfoRow label="Format" value="Public promise" />
                  <InfoRow label="Result" value="Evidence or transfer" />
                </div>
              </div>
              <div className="border-x border-b border-black bg-[var(--bg-0)] p-6">
                <p className="pn-kicker mb-3">Press Access</p>
                <p className="pn-copy mb-5 text-sm text-justify">
                  Connect the wallet you use for drafting, staking, and settlement.
                </p>
                <ConnectButton />
              </div>
              <div className="border-x border-b border-black bg-black p-6 text-[var(--bg-0)]">
                <p className="pn-kicker mb-3 text-white/60">Byline</p>
                <p
                  className="text-base leading-relaxed text-white/80"
                  style={{ fontFamily: 'var(--font-body), Georgia, serif' }}
                >
                  “A serious interface should feel like a published record, not a soft
                  promise to yourself.”
                </p>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="relative py-16 lg:py-20">
        <div className="mx-auto w-[var(--container)]">
          <div className="max-w-3xl border-t-4 border-black pt-6">
            <p className="pn-kicker mb-3 text-[var(--accent)]">How It Works</p>
            <h2 className="pn-title text-4xl lg:text-5xl">Three steps. One clear outcome.</h2>
            <p className="pn-copy mt-5 text-lg text-justify">
              Create the commitment, attach the stake, and submit proof before the
              deadline. If you miss, the money goes where you said it should.
            </p>
          </div>

          <div className="mt-10 border-t border-black">
            {PROCESS.map((step) => (
              <article
                key={step.numeral}
                className="grid gap-4 border-b border-black py-6 lg:grid-cols-[8rem_minmax(0,1fr)] lg:gap-8"
              >
                <div className="pn-ui text-xs uppercase tracking-[0.16em] text-[var(--accent)]">
                  {step.numeral}
                </div>
                <div>
                  <h3 className="pn-title text-2xl lg:text-3xl">{step.title}</h3>
                  <p className="pn-copy mt-3 max-w-3xl text-justify">{step.copy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-black py-16 text-[var(--bg-0)] lg:py-20">
        <div className="mx-auto w-[var(--container)]">
          <div className="max-w-3xl">
            <p className="pn-kicker mb-3 text-white/55">Why People Use It</p>
            <h2 className="pn-title text-4xl lg:text-5xl">
              It is easier to act
              <br />
              when the cost is real.
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
              Procrastinot works because it removes wiggle room. You know the task, you
              know the deadline, and you know what happens if you fail.
            </p>
          </div>

          <div className="mt-10 border-t border-white/10">
            {PRINCIPLES.map((item) => (
              <article
                key={item.label}
                className="grid gap-3 border-b border-white/10 py-6 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8"
              >
                <h3 className="pn-ui text-xs uppercase tracking-[0.16em] text-[var(--accent)]">
                  {item.label}
                </h3>
                <p className="max-w-3xl text-justify leading-relaxed text-white/72">
                  {item.copy}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-12 border border-white/15 bg-white/[0.03] p-8 lg:p-10">
            <h2 className="pn-title text-3xl lg:text-5xl">Set the task and let it hold.</h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-white/70">
              Create a commitment, attach the stake, and stop relying on a better mood
              tomorrow.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/create" className="pn-btn pn-btn-primary">
                Start a commitment
              </Link>
              <Link href="/my" className="pn-btn border-white text-white hover:bg-white hover:text-black">
                View my commitments
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
      <span className="pn-ui text-[11px] uppercase tracking-[0.14em] text-[var(--ink-2)]">{label}</span>
      <span className="text-right text-sm">{value}</span>
    </div>
  );
}
