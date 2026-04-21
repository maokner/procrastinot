'use client';

import { useEffect, useRef, useState } from 'react';

function format(remaining: number): string {
  if (remaining <= 0) return 'expired';
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Countdown component that ticks once per second.
 * Accepts an ISO string or unix-seconds bigint/number.
 */
export function DeadlineCountdown({
  deadline,
  onExpire,
  className,
}: {
  deadline: string | number | bigint;
  onExpire?: () => void;
  className?: string;
}) {
  const deadlineSec =
    typeof deadline === 'string'
      ? Math.floor(new Date(deadline).getTime() / 1000)
      : Number(deadline);

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const firedRef = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = deadlineSec - now;

  useEffect(() => {
    if (!firedRef.current && remaining <= 0) {
      firedRef.current = true;
      onExpire?.();
    }
  }, [remaining, onExpire]);

  const expired = remaining <= 0;
  return (
    <span className={className ?? (expired ? 'text-[var(--danger)]' : 'text-[var(--ink-0)]')}>
      {format(remaining)}
    </span>
  );
}
