import { gmrEngine } from '../src/services/web3.services/gmrEngine.service';
import { ticketPublicClient, ticketChain } from '../src/config/ticketChain';

if (!gmrEngine.configured()) throw new Error('Configure GMR_ENGINE_API_BASE and GMR_ENGINE_API_KEY first.');
const actualChain = await ticketPublicClient.getChainId();
if (actualChain !== ticketChain.id) throw new Error('Engine RPC network does not match the ticket network.');
const block = await ticketPublicClient.getBlockNumber();
console.log(JSON.stringify({ engine: 'connected', chainId: actualChain, network: ticketChain.name, block: block.toString() }));
const address = process.env.TICKET_CONTRACT_ADDRESS;
if (!address) {
  console.log('On-chain tickets are not ready: deploy/configure a ticket contract on this network. Existing mock tickets are unchanged.');
} else {
  const code = await ticketPublicClient.getCode({ address: address as `0x${string}` });
  if (!code || code === '0x') throw new Error('Configured ticket address has no deployed contract on this network.');
  console.log('Configured ticket contract has deployed bytecode; mint/transfer authority still requires verification.');
}
