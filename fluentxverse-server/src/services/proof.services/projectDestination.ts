import { MAINNET_RECEIPT_DESTINATIONS } from './horizenReceipt';

export type ProofEngineNamespace = 'GMR_SCREENING' | 'GMR_PAYOUT' | 'GMR_ANONYMOUS_REVIEWS' | 'GMR_ANONYMOUS_TALLY';
const rpcUrls: Record<number, string> = {
  8453: 'https://mainnet.base.org', 42161: 'https://arb1.arbitrum.io/rpc',
  33139: 'https://rpc.apechain.com/http', 10: 'https://mainnet.optimism.io',
  4663: 'https://robinhood.drpc.org',
};

export function mainnetReceiptCoordinates(chainId: number) {
  const destination = MAINNET_RECEIPT_DESTINATIONS.find(d => d.chainId === chainId);
  if (!destination) throw Error('Unsupported mainnet receipt destination');
  return { ...destination, rpcUrl: rpcUrls[chainId]! };
}

export async function engineReceiptDestination(namespace: ProofEngineNamespace) {
  if (process.env.PROOF_DESTINATION_MODE !== 'project') return null;
  const base = (process.env[`${namespace}_ENGINE_API_BASE`] || '').replace(/\/$/, '');
  const key = process.env[`${namespace}_ENGINE_API_KEY`] || '';
  if (!base || !key) throw Error('Project destination Engine connection is not configured');
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal', 'gmr-engine', 'budol-gmr-engine-1'].includes(url.hostname))))
    throw Error('Project destination requires an approved Engine transport');
  const response = await fetch(base + '/v1/zkverify/destination', {
    headers: { 'X-GMR-Engine-Key': key }, signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  if (!response.ok) throw Error('Project receipt destination is unavailable');
  if (!response.body) throw Error('Empty project destination response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16384) { await reader.cancel(); throw Error('Project destination response exceeds limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const { destination } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const approved = mainnetReceiptCoordinates(destination?.chainId);
  if (destination.domainId !== approved.domainId || typeof destination.bridge !== 'string'
    || destination.bridge.toLowerCase() !== approved.bridge.toLowerCase()) throw Error('Project destination coordinates differ');
  return approved;
}
