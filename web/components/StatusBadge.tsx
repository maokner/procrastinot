import { Status } from '@procrastinot/abi';

const MAP: Record<Status, { label: string; classes: string }> = {
  [Status.Active]: {
    label: 'Active',
    classes: 'bg-neutral-800 text-neutral-200 border-neutral-700',
  },
  [Status.Completed]: {
    label: 'Completed',
    classes: 'bg-green-950 text-green-300 border-green-900',
  },
  [Status.Forfeited]: {
    label: 'Forfeited',
    classes: 'bg-red-950 text-red-300 border-red-900',
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
