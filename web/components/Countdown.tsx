'use client';

import { useEffect, useState } from 'react';
import { countdown } from '@/lib/format';

export function Countdown({ deadline }: { deadline: bigint }) {
  const [text, setText] = useState(() => countdown(deadline));

  useEffect(() => {
    const id = setInterval(() => {
      setText(countdown(deadline));
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const expired = text === 'expired';
  return (
    <span className={expired ? 'text-red-400' : 'text-neutral-200'}>{text}</span>
  );
}
