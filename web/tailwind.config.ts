import type { Config } from 'tailwindcss';

// Tailwind v4 largely auto-detects content; this file is kept minimal
// for compatibility with tooling that still expects a config file.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
};

export default config;
