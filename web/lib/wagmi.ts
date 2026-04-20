import { createConfig, http } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

// Lean wagmi config. No RainbowKit. No WalletConnect in the default bundle.
// WalletConnect is code-split and loaded on demand from <ConnectButton>.
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: rpcUrl ? http(rpcUrl) : http(),
  },
  ssr: true,
});

export type WagmiConfig = typeof wagmiConfig;
