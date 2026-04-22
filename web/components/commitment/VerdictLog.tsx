import type { VerdictEvent } from '@/lib/db-types';
import { etherscanTxUrl } from '@/lib/format';
import { EvidencePreview } from './EvidencePreview';

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - then) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function labelFor(ev: VerdictEvent): string {
  switch (ev.kind) {
    case 'requested':
      return `Attempt ${ev.attempt ?? '?'}: evidence submitted`;
    case 'submitted':
      return ev.passed ? 'Oracle: passed' : 'Oracle: rejected';
    case 'forfeited':
      return 'Forfeited past deadline';
  }
}

export function VerdictLog({
  events,
  chainId = 11155111,
}: {
  events: VerdictEvent[];
  chainId?: number;
}) {
  if (events.length === 0) {
    return <p className="text-sm text-[var(--ink-2)]">No attempts yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {events.map((ev) => (
        <li
          key={ev.id}
          className="border border-black bg-white p-4"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">{labelFor(ev)}</span>
            <span className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--ink-2)]">
              <span>{relative(ev.created_at)}</span>
              <a
                href={etherscanTxUrl(ev.tx_hash, chainId)}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-[var(--ink-0)]"
              >
                tx
              </a>
            </span>
          </div>
          {ev.evidence_uri && <EvidencePreview uri={ev.evidence_uri} />}
        </li>
      ))}
    </ul>
  );
}
