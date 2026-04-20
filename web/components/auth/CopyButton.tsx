'use client';

import { useState } from 'react';

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no-op
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-900"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
