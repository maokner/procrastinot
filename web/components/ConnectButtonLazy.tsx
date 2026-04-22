'use client';

import dynamic from 'next/dynamic';

// Client-only lazy boundary so Server Components can pull in a wallet-aware
// button without bloating their first-load bundle.
export const ConnectButtonLazy = dynamic(
  () => import('./ConnectButton').then((m) => m.ConnectButton),
  {
    ssr: false,
    loading: () => (
      <div className="h-11 w-[168px] border-2 border-black bg-black" aria-hidden />
    ),
  },
);

export default ConnectButtonLazy;
