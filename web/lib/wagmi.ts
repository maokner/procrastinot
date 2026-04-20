import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';
import { http } from 'viem';

// WalletConnect requires a projectId. For local demos without a cloud account,
// fall back to RainbowKit's public demo projectId — WalletConnect mobile linking
// won't be reliable, but MetaMask / injected wallets work fine for the flow.
// In production, set NEXT_PUBLIC_WALLETCONNECT_ID (free at cloud.walletconnect.com).
const DEMO_PROJECT_ID = '21fef48091f12692cad574a6f7753643';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID || DEMO_PROJECT_ID;
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;

export const wagmiConfig = getDefaultConfig({
  appName: 'Procrastinot',
  projectId,
  chains: [sepolia],
  transports: {
    [sepolia.id]: rpcUrl ? http(rpcUrl) : http(),
  },
  ssr: true,
});
