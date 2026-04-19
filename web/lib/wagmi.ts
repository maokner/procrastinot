import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';
import { http } from 'viem';

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_ID ?? 'procrastinot-dev';
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
