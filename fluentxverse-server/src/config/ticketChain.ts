import { createPublicClient, custom } from 'viem';
import { arbitrumSepolia, baseSepolia } from 'viem/chains';
import { gmrEngine } from '../services/web3.services/gmrEngine.service';

export function selectTicketChain(id = Number(process.env.TICKET_CHAIN_ID || baseSepolia.id)) {
  const chain = [baseSepolia, arbitrumSepolia].find(chain => chain.id === id);
  if (!chain) throw new Error(`Unsupported ticket chain ${id}`);
  return chain;
}

export const ticketChain = selectTicketChain();
export const ticketPublicClient = createPublicClient({
  chain: ticketChain,
  transport: custom({ request: ({ method, params }) => gmrEngine.rpc(ticketChain.id, method, (params || []) as unknown[]) }),
});
