import type { Metadata } from 'next';
import { Fraunces, Manrope } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { AppHeader } from '@/components/layout/AppHeader';

const manrope = Manrope({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-brand',
});

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
    <html lang="en">
      <body className={`${manrope.variable} ${fraunces.variable} pn-body min-h-screen`}>
        <Providers>
          {/* AppHeader is a server component but lives inside Providers so
              SessionMenu's wagmi hooks have a WagmiProvider ancestor. */}
          <AppHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
