import { createPublicClient, http, type PublicClient } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { procrastinotAbi } from '@procrastinot/abi';
import type { Config } from './config.js';

export type ChainClients = {
  publicClient: PublicClient;
  contractAddress: `0x${string}`;
};

/**
 * Re-export the ABI. The @procrastinot/abi package now ships a real typed
 * `as const` ABI post-Phase-B, so we can use it directly without casting —
 * viem's getLogs/decodeEventLog inference will key off event names.
 */
export { procrastinotAbi };

export function createChainClients(config: Config): ChainClients {
  const chain = config.chain === 'sepolia' ? sepolia : mainnet;
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  return {
    publicClient,
    contractAddress: config.contractAddress,
  };
}
