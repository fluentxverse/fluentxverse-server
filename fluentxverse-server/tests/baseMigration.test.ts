import { afterEach, expect, test } from 'bun:test';
import { BASE_MAINNET_BRIDGE, BASE_SEPOLIA_BRIDGE, HORIZEN_TESTNET_BRIDGE, assertHorizenReceiptConfig, horizenVerificationNetwork, HorizenReceiptReader } from '../src/services/proof.services/horizenReceipt';
import { reviewGroupId } from '../src/services/anonymousReviews/policy';

const prior = process.env.ANONYMOUS_REVIEWS_CHAIN_ID;
afterEach(() => { if (prior === undefined) delete process.env.ANONYMOUS_REVIEWS_CHAIN_ID; else process.env.ANONYMOUS_REVIEWS_CHAIN_ID = prior; });
test('Base and Base Sepolia pin distinct native networks and official receipt coordinates', () => {
  expect(horizenVerificationNetwork(8453)).toBe('zkVerify');
  expect(horizenVerificationNetwork(84532)).toBe('Volta');
  const base = { chainId: 8453, domainId: 2, bridge: BASE_MAINNET_BRIDGE, rpcUrl: 'https://base.example' };
  expect(() => assertHorizenReceiptConfig(base)).not.toThrow();
  expect(() => assertHorizenReceiptConfig({ ...base, chainId: 84532, bridge: BASE_SEPOLIA_BRIDGE })).not.toThrow();
  for (const patch of [{ domainId: 3 }, { chainId: 26514 }, { chainId: 84532 }, { bridge: HORIZEN_TESTNET_BRIDGE }]) expect(() => assertHorizenReceiptConfig({ ...base, ...patch })).toThrow();
});
test('Base review cohorts cannot reuse legacy cohorts or another destination scope', () => {
  const ids = [8453, 84532, 26514, 2651420].map(chain => { process.env.ANONYMOUS_REVIEWS_CHAIN_ID = String(chain); return reviewGroupId('fixture', '2026-10'); });
  expect(new Set(ids).size).toBe(4);
});
test('Base receipts cannot be accepted from a Horizen RPC even when contract addresses match', async () => {
  const reader = new HorizenReceiptReader(() => ({ getChainId: async () => 26514 } as any));
  await expect(reader.check({ chainId: 8453, domainId: 2, bridge: BASE_MAINNET_BRIDGE, rpcUrl: 'https://base.example' })).rejects.toThrow('Wrong');
});
