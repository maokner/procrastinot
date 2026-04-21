import { Status } from '@procrastinot/abi';

const MAP: Record<Status, { label: string; classes: string }> = {
  [Status.Active]: {
    label: 'Active',
    classes: 'bg-white/80 text-[var(--ink-1)] border-[var(--line)]',
  },
  [Status.Completed]: {
    label: 'Completed',
    classes: 'bg-[color-mix(in_srgb,var(--success)_12%,white)] text-[var(--success)] border-[color-mix(in_srgb,var(--success)_35%,var(--line))]',
  },
  [Status.Forfeited]: {
    label: 'Forfeited',
    classes: 'bg-[color-mix(in_srgb,var(--danger)_10%,white)] text-[var(--danger)] border-[color-mix(in_srgb,var(--danger)_35%,var(--line))]',
  },
};

export function StatusBadge({ status }: { status: Status | number }) {
  const key = (status as number) as Status;
  const entry = MAP[key] ?? MAP[Status.Active];
  return (
    <span
      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium uppercase tracking-wide ${entry.classes}`}
    >
      {entry.label}
    </span>
  );
}
