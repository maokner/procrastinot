import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Lora, Playfair_Display } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { AppHeader } from '@/components/layout/AppHeader';

const body = Lora({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});
const brand = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-brand',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});
const ui = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-ui',
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
      <body className={`${body.variable} ${brand.variable} ${mono.variable} ${ui.variable} pn-body min-h-screen`}>
        <Providers>
          <a href="#content-start" className="pn-skip-link">
            Skip to content
          </a>
          {/* AppHeader is a server component but lives inside Providers so
              SessionMenu's wagmi hooks have a WagmiProvider ancestor. */}
          <AppHeader />
          <div id="content-start">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
