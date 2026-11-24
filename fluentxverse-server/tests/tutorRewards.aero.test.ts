import { expect, test } from 'bun:test';
import { AlchemyRewardPrices, rewardPrice18 } from '../src/services/tutorRewards/alchemy';
import { AeroTutorRewards, aeroPath, type AeroRewardManifest } from '../src/services/tutorRewards/aero';
import { pin } from '../src/services/tutorRewards/gateway';
import compiled from '../../shared/tutorRewardsAeroArtifact.json';

const token = '0x1111111111111111111111111111111111111111', feed = '0x2222222222222222222222222222222222222222';
const adapter = '0x3333333333333333333333333333333333333333', factory = '0x4444444444444444444444444444444444444444';
const router = '0x5555555555555555555555555555555555555555', pool = '0x6666666666666666666666666666666666666666';
const now = Date.parse('2026-11-04T09:00:00Z');
const observedAt = new Date(now - 60000).toISOString();
const payload = () => ({ data: [{ network: 'robinhood-mainnet', address: token, prices: [{ currency: 'usd', value: '100', lastUpdatedAt: observedAt }], error: null }] });
async function withKey<T>(run: () => Promise<T>) {
  const old = process.env.TUTOR_REWARDS_ALCHEMY_API_KEY; process.env.TUTOR_REWARDS_ALCHEMY_API_KEY = 'synthetic-private-key';
  try { return await run(); } finally { if (old === undefined) delete process.env.TUTOR_REWARDS_ALCHEMY_API_KEY; else process.env.TUTOR_REWARDS_ALCHEMY_API_KEY = old; }
}
test('Alchemy prices retain exact decimals without exponent or floating point conversion', () => {
  expect(rewardPrice18('100.123456789012345678')).toBe(100123456789012345678n);
  expect(rewardPrice18('0.12345678901234567899')).toBe(123456789012345678n);
  for (const value of ['0', '-1', '1e2', 'NaN', '0.00000000000000000001', '', 1]) expect(() => rewardPrice18(value)).toThrow();
});
test('Alchemy requests exact Robinhood token addresses and keeps source timestamps', async () => withKey(async () => {
  let body: any, url: any;
  const p = new AlchemyRewardPrices((async (u, init) => { url = u; body = JSON.parse(init!.body as string); return Response.json(payload()); }) as typeof fetch, () => now);
  const [result] = await p.get([token, token]);
  expect(url).toBe('https://api.g.alchemy.com/prices/v1/tokens/by-address');
  expect(url).not.toContain('synthetic-private-key');
  expect(body).toEqual({ addresses: [{ network: 'robinhood-mainnet', address: token }] });
  expect(result!.observedAt).toBe((now - 60000) / 1000); expect(result!.price).toBe(100n * 10n ** 18n);
  expect(result!.observationHash).toMatch(/^0x[0-9a-f]{64}$/);
}));
test('missing, duplicate, wrong-network, stale and future prices fail closed', async () => withKey(async () => {
  const variants: any[] = [ { data: [] }, { data: [...payload().data, ...payload().data] }, payload(), payload(), payload(), payload() ];
  variants[2].data[0].network = 'base-mainnet';
  variants[3].data[0].prices[0].lastUpdatedAt = new Date(now - 301000).toISOString();
  variants[4].data[0].prices[0].lastUpdatedAt = new Date(now + 1000).toISOString();
  variants[5].data[0].prices.push({ ...variants[5].data[0].prices[0] });
  for (const body of variants) {
    const p = new AlchemyRewardPrices((async () => Response.json(body)) as unknown as typeof fetch, () => now);
    await expect(p.get([token])).rejects.toThrow();
  }
}));
test('Alchemy errors never expose provider response bodies or credentials', async () => withKey(async () => {
  const p = new AlchemyRewardPrices((async () => new Response('synthetic-private-key secret provider detail', { status: 403 })) as unknown as typeof fetch, () => now);
  await expect(p.get([token])).rejects.toThrow('Alchemy reward prices are unavailable. No substitute price was used.');
}));
const config: AeroRewardManifest = { chainId: 4663, network: 'robinhood-mainnet', adapter, factory, router, quoter: router,
  assets: [{ token, feed, tokens: [pin.settlementToken, token], tickSpacings: [50] }] };
function fixture() {
  let expected = 120000000000000000n, path = aeroPath(config.assets[0]!), paused = false, feedTimestamp = BigInt(now / 1000 - 60);
  const g: any = { chain: async () => {}, configured: () => true, status: async () => ({ deployed: true, finalized: true, claimsPaused: true, maxQuoteAgeSeconds: 300 }),
    read: async (fn: string) => fn === 'rewardAssets' ? [adapter, feed, 300, 100, 18, 18, 1n, true] : fn === 'oracleMinimumOut' ? 118800000000000000n : 1n,
    client: { getCode: async ({ address }: any) => address === adapter ? compiled.adapter.runtime : address === feed ? compiled.feed.runtime : '0x01', getBlock: async () => ({ timestamp: BigInt(now / 1000) }), simulateContract: async () => ({ result: [expected, [], []] }),
      readContract: async ({ functionName: fn }: any) => ({ rewards: pin.contract, settlementToken: pin.settlementToken, factory, router, paused, paths: path,
        token, publisher: pin.operator, decimals: 18, maxObservationAge: 300, getPool: pool, liquidity: 100n,
        latestRoundData: [1n, 100n * 10n ** 18n, feedTimestamp, feedTimestamp, 1n] } as any)[fn] } };
  const prices = new AlchemyRewardPrices((async () => Response.json(payload())) as unknown as typeof fetch, () => now);
  return { integration: new AeroTutorRewards(config, g, prices, () => now), g, badOutput: () => { expected = 100000000000000000n; }, badPath: () => { path = '0x00'; }, pause: () => { paused = true; },
    expiringFeed: () => { feedTimestamp = BigInt(now / 1000 - 280); } };
}
test('Aero quote binds verified route, source price, minimum output, deadline and version without executing a purchase', async () => withKey(async () => {
  const f = fixture(); const q = await f.integration.quote(token, '12');
  expect(q.expectedAmountOut).toBe('120000000000000000'); expect(q.minAmountOut).toBe('118800000000000000');
  expect(q.deadline - q.quotedAt).toBe(120); expect(q.pools).toEqual([pool]); expect(q.data).toBe(aeroPath(config.assets[0]!));
  expect(q.assetVersion).toBe('1'); expect(q.claimsPaused).toBe(true);
  expect(q.referenceObservedAt).toBe((now - 60000) / 1000);
}));
test('poor execution, changed paths, paused adapters, unsupported assets and empty manifests never generate usable quotes', async () => withKey(async () => {
  for (const change of ['badOutput', 'badPath', 'pause'] as const) { const f = fixture(); f[change](); await expect(f.integration.quote(token, '12')).rejects.toThrow(); }
  await expect(new AeroTutorRewards().quote(token, '12')).rejects.toThrow('not been deployed and approved');
  await expect(fixture().integration.quote(pool, '12')).rejects.toThrow('not been deployed and approved');
}));
test('quote expiry never outlives the older onchain feed observation', async () => withKey(async () => {
  const f = fixture(); f.expiringFeed(); const q = await f.integration.quote(token, '12');
  expect(q.deadline - q.quotedAt).toBe(20);
}));
test('unexpected adapter executable code is rejected even when getters return the expected addresses', async () => withKey(async () => {
  const f = fixture(); f.g.client.getCode = async () => '0x00';
  await expect(f.integration.quote(token, '12')).rejects.toThrow('runtime differs');
}));
test('packed Aero paths use int24 tick spacing and reject cycles, wrong endpoints and excessive hops', () => {
  expect(aeroPath(config.assets[0]!)).toContain('000032');
  for (const a of [ { ...config.assets[0]!, tickSpacings: [0] }, { ...config.assets[0]!, tokens: [token, pin.settlementToken] },
    { ...config.assets[0]!, tokens: [pin.settlementToken, token, pin.settlementToken, token], tickSpacings: [50,50,50] } ]) expect(() => aeroPath(a)).toThrow();
});
