import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@procrastinot/abi'],
  reactStrictMode: true,
  webpack(config) {
    // `@procrastinot/abi/src/index.ts` uses NodeNext-style `./types.js`
    // specifiers that resolve to `.ts` files on disk. Teach webpack to
    // do the same lookup (same behaviour as tsc's `moduleResolution:
    // "NodeNext"`).
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
