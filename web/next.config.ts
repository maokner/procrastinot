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
    // Silence the MetaMask SDK's optional React Native AsyncStorage import
    // when bundling for the browser. It's a soft dep used only in RN.
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      '@react-native-async-storage/async-storage': false,
    };
    return config;
  },
};

export default nextConfig;
