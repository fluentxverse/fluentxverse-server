import { afterAll, expect, test } from 'bun:test';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { publishRewardPrices } from '../src/services/tutorRewards/pricePublisher';

const uri = process.env.REWARDS_PRICES_TEST_MEMGRAPH_URI;
const it = uri ? test : test.skip;
async function run(cypher: string) { const s = getDriver().session(); try { return await s.run(cypher); } finally { await s.close(); } }
if (uri) {
  if (!['bolt://127.0.0.1:17734', 'bolt://127.0.0.1:17735'].includes(uri)) throw Error('Only a dedicated disposable rewards graph is allowed.');
  await initDriver(uri, '', '', 1); await run('MATCH(n) DETACH DELETE n');
}
afterAll(async () => { if (uri) await closeDriver(); });
it('price outbox persists before enqueue, retries the same observation and never submits a purchase', async () => {
  const old = process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED;
  const asset = { token: '0x1111111111111111111111111111111111111111', feed: '0x2222222222222222222222222222222222222222' };
  let uncertain = true, calls = 0, observed = 1793782800, reads = 0;
  const submissions: any[] = [];
  const integration: any = {
    config: { adapter: '0x3333333333333333333333333333333333333333', assets: [asset] },
    asset: () => asset, bindings: async () => {}, prices: { configured: () => true },
    publication: async () => { reads++; return { feed: asset.feed, args: ['100000000000000000000', observed, '0x' + '1'.repeat(64)] }; },
    gateway: { configured: () => true, status: async () => ({ deployed: true, finalized: true, reservedUsd: '12000000' }),
      submitContract: async (...args: any[]) => {
        const persisted = (await run('MATCH(p:TutorRewardPricePublication) RETURN p')).records;
        expect(persisted).toHaveLength(1); expect(persisted[0]!.get('p').properties.argsJson).toBe(JSON.stringify(args[4]));
        submissions.push(args); calls++;
        if (uncertain) { uncertain = false; throw Error('synthetic uncertain enqueue'); }
        return 'engine-fixture';
      },
      contractOperation: async (...args: any[]) => {
        expect(args[1]).toBe(asset.feed); expect(args[3]).toBe('publish');
        return { status: 'finalized', transactionHash: '0x' + '2'.repeat(64) };
      },
    },
  };
  try {
    process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED = 'false'; await publishRewardPrices(integration); expect(calls).toBe(0);
    process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED = 'true';
    await expect(publishRewardPrices(integration)).rejects.toThrow('could not be updated');
    await publishRewardPrices(integration);
    expect(reads).toBe(1); expect(calls).toBe(2);
    expect(submissions[0][0]).toBe(submissions[1][0]); expect(submissions[0][3]).toBe('publish');
    expect(submissions[0][4]).toEqual(submissions[1][4]); expect(submissions[1][5]).toBe(true);
    await publishRewardPrices(integration); expect(calls).toBe(2);
    const row = (await run('MATCH(p:TutorRewardPricePublication) RETURN p')).records[0]!.get('p').properties;
    expect(row.status).toBe('finalized'); expect(row.engineTransactionId).toBe('engine-fixture');
    expect(submissions.every(s => s[3] === 'publish')).toBe(true);
  } finally {
    if (old === undefined) delete process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED;
    else process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED = old;
  }
});
it('mined observations do not block fresh updates, and zero reserves stop recurring gas spend', async () => {
  await run('MATCH(n:TutorRewardPricePublication) DETACH DELETE n');
  const old = process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED;
  const asset = { token: '0x1111111111111111111111111111111111111111', feed: '0x2222222222222222222222222222222222222222' };
  let reserved = '12000000', reads = 0, sent = 0, reconciled = 0;
  const integration: any = {
    config: { adapter: asset.feed, assets: [asset] }, prices: { configured: () => true }, asset: () => asset,
    bindings: async () => {}, publication: async () => ({ feed: asset.feed,
      args: ['100000000000000000000', 1793782800 + reads++, '0x' + '1'.repeat(64)] }),
    gateway: { configured: () => true, status: async () => ({ deployed: true, finalized: true, reservedUsd: reserved }),
      submitContract: async () => 'fresh-observation-' + ++sent,
      contractOperation: async () => { reconciled++; return { status: 'confirming', transactionHash: '0x' + '2'.repeat(64) }; } },
  };
  try {
    process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED = 'true';
    await publishRewardPrices(integration); await publishRewardPrices(integration);
    expect(sent).toBe(2); expect(reads).toBe(2);
    expect((await run('MATCH(p:TutorRewardPricePublication) RETURN p')).records).toHaveLength(2);
    reserved = '0'; const before = reconciled;
    await publishRewardPrices(integration);
    expect(sent).toBe(2); expect(reads).toBe(2); expect(reconciled - before).toBe(2);
  } finally {
    if (old === undefined) delete process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED;
    else process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED = old;
  }
});
it('one unavailable price does not stop an independent feed update', async () => {
  await run('MATCH(n:TutorRewardPricePublication) DETACH DELETE n');
  const old = process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED;
  const assets = [
    { token: '0x1111111111111111111111111111111111111111', feed: '0x2222222222222222222222222222222222222222' },
    { token: '0x3333333333333333333333333333333333333333', feed: '0x4444444444444444444444444444444444444444' },
  ];
  const sent: string[] = [];
  const integration: any = { config: { adapter: assets[0]!.feed, assets }, prices: { configured: () => true },
    asset: (token: string) => assets.find(a => a.token === token), bindings: async () => {},
    publication: async (token: string) => {
      if (token === assets[0]!.token) throw Error('Synthetic missing price');
      return { feed: assets[1]!.feed, args: ['100000000000000000000', 1793782800, '0x' + '1'.repeat(64)] };
    },
    gateway: { configured: () => true, status: async () => ({ deployed: true, finalized: true, reservedUsd: '12000000' }),
      submitContract: async (_id: string, feed: string) => { sent.push(feed); return 'second-feed-operation'; },
      contractOperation: async () => ({ status: 'finalized', transactionHash: '0x' + '2'.repeat(64) }) },
  };
  try {
    process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED = 'true';
    await expect(publishRewardPrices(integration)).rejects.toThrow('could not be updated');
    expect(sent).toEqual([assets[1]!.feed]);
    const rows = (await run('MATCH(p:TutorRewardPricePublication) RETURN p')).records;
    expect(rows).toHaveLength(1); expect(rows[0]!.get('p').properties.status).toBe('finalized');
  } finally {
    if (old === undefined) delete process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED;
    else process.env.TUTOR_REWARDS_PRICE_PUBLISHING_ENABLED = old;
  }
});
