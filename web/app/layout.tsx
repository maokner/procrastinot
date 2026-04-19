import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Procrastinot',
  description: 'Commit. Or pay your enemy.',
};

// Avoid prerender-time errors from wallet SDKs that touch browser globals.
export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} min-h-screen bg-neutral-950 text-neutral-100`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
