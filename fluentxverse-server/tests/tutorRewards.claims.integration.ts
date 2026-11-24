import { afterAll, expect, mock, test } from 'bun:test';
import { privateKeyToAccount } from 'viem/accounts';
import { hashTypedData } from 'viem';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import pin from '../../shared/tutorRewardsDeployment.json';
import { tutorRewardClaimTypes } from '../../shared/tutorRewardClaim';
const uri = process.env.REWARDS_CLAIMS_TEST_MEMGRAPH_URI, it = uri ? test : test.skip;
const wallet = privateKeyToAccount('0x' + '11'.repeat(32) as `0x${string}`), token = '0x1111111111111111111111111111111111111111';
const publicId = '0x' + '1'.repeat(64), wrongId = '0x' + '2'.repeat(64);
let authorizations = 0, uncertain = false, wrongSignature = false;
const submitted: any[] = [];
async function run(cypher: string, params: any = {}) { const s = getDriver().session(); try { return await s.run(cypher, params); } finally { await s.close(); } }
const gateway: any = {
  configured: () => true,
  status: async () => ({ deployed: true, finalized: true, claimsPaused: false }),
  read: async (fn: string, args: any[]) => fn === 'tutorWallets' ? (args[0] === publicId ? wallet.address.toLowerCase() : '0x2222222222222222222222222222222222222222')
    : fn === 'recoveries' ? ['0x' + '0'.repeat(40), 0] : fn === 'availableUsd' ? 12000000n : fn === 'nonces' ? 0n : [],
  client: { getBlock: async () => ({ timestamp: BigInt(Math.floor(Date.now()/1000)) }), readContract: async () => 'NVDA' },
  request: async (_path: string, p: any) => {
    authorizations++; expect(p.userId).toBe('tutor-fixture'); expect(p.wallet).toBe(wallet.address.toLowerCase());
    const typed = { domain: { name: 'FluentXVerse Tutor Rewards', version: '1', chainId: 4663, verifyingContract: pin.contract as `0x${string}` },
      types: tutorRewardClaimTypes, primaryType: 'Claim' as const, message: p.claim };
    const account = wrongSignature ? privateKeyToAccount('0x' + '22'.repeat(32) as `0x${string}`) : wallet;
    return { signature: await account.signTypedData(typed), digest: hashTypedData(typed) };
  },
  submit: async (...args: any[]) => {
    const rows = (await run('MATCH(c:TutorRewardClaim) WHERE c.signature IS NOT NULL RETURN c')).records;
    expect(rows.length).toBeGreaterThan(0); submitted.push(args);
    if (uncertain) { uncertain = false; throw Error('synthetic uncertain response'); }
    return 'claim-fixture-engine-id';
  },
  operation: async () => ({ status: 'finalized', transactionHash: '0x' + '3'.repeat(64) }),
};
mock.module('../src/services/tutorRewards/gateway', () => ({ pin, rewardsGateway: gateway }));
mock.module('../src/services/tutorRewards/aero', () => ({ aeroTutorRewards: { config: { assets: [] }, quote: async () => ({
  token, amountUsd: '12000000', minAmountOut: '100000000000000000', expectedAmountOut: '120000000000000000',
  quotedAt: Math.floor(Date.now()/1000), deadline: Math.floor(Date.now()/1000)+120,
  assetVersion: '1', executionEpoch: '2', data: '0x1234', dataHash: '0x' + '4'.repeat(64),
}) } }));
const { tutorRewardClaims: claims } = await import('../src/services/tutorRewards/claims');
if (uri) {
  if (uri !== 'bolt://127.0.0.1:17735') throw Error('Only the disposable claims graph is allowed.');
  await initDriver(uri, '', '', 1); await run('MATCH(n) DETACH DELETE n');
  await run(`CREATE(:User {id:'tutor-fixture',smartWalletAddress:$wallet}),(:TutorRewardIdentity {tutorId:'tutor-fixture',publicId:$id}),
    (:User {id:'other-tutor',smartWalletAddress:$other}),(:TutorRewardIdentity {tutorId:'other-tutor',publicId:$otherId})`, {
    wallet: { userId: 'tutor-fixture', address: wallet.address.toLowerCase() }, id: publicId,
    other: { userId: 'other-tutor', address: '0x2222222222222222222222222222222222222222' }, otherId: wrongId,
  });
}
const old = process.env.TUTOR_REWARDS_CLAIMS_APPROVED;
afterAll(async () => { if (old === undefined) delete process.env.TUTOR_REWARDS_CLAIMS_APPROVED; else process.env.TUTOR_REWARDS_CLAIMS_APPROVED = old; if (uri) await closeDriver(); });
it('managed confirmation binds authenticated tutor, persists authorization and recovers uncertain enqueue without a replacement claim', async () => {
  process.env.TUTOR_REWARDS_CLAIMS_APPROVED = 'false'; await expect(claims.quote('tutor-fixture', token, '12')).rejects.toThrow('not open');
  process.env.TUTOR_REWARDS_CLAIMS_APPROVED = 'true';
  await expect(claims.quote('tutor-fixture', token, '13')).rejects.toThrow('exceeds');
  const q = await claims.quote('tutor-fixture', token, '12');
  await expect(claims.confirm('other-tutor', q.id)).rejects.toThrow('not found'); expect(authorizations).toBe(0);
  wrongSignature = true; await expect(claims.confirm('tutor-fixture', q.id)).rejects.toThrow('could not be verified'); expect(submitted).toHaveLength(0);
  wrongSignature = false; uncertain = true;
  await expect(claims.confirm('tutor-fixture', q.id)).rejects.toThrow('uncertain');
  const authorized = authorizations;
  const result = await claims.confirm('tutor-fixture', q.id); expect(result.status).toBe('queued');
  expect(authorizations).toBe(authorized); expect(submitted).toHaveLength(2);
  expect(submitted[0][0]).toBe('claim:' + q.id); expect(submitted[1][0]).toBe(submitted[0][0]);
  expect(submitted[1][2]).toEqual(submitted[0][2]); expect(submitted[1][4]).toBe(true);
  expect(submitted[0][2][0].wallet).toBe(wallet.address.toLowerCase());
  const competing = await claims.quote('tutor-fixture', token, '12');
  await expect(claims.confirm('tutor-fixture', competing.id)).rejects.toThrow('still pending');
  await claims.reconcile('tutor-fixture');
  const summary = await claims.summary('tutor-fixture');
  const completed = summary.claims.find(c => c.id === q.id)!; expect(completed.status).toBe('finalized');
  expect(completed.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
  const repeated = await claims.confirm('tutor-fixture', q.id); expect(repeated.status).toBe('finalized'); expect(submitted).toHaveLength(2);
  expect(JSON.stringify(summary)).not.toContain('signature'); expect(JSON.stringify(summary)).not.toContain('claimJson');
});
it('an expired durable authorization without an enqueue attempt releases the pending claim hold', async () => {
  await run("MATCH(c:TutorRewardClaim) WHERE c.status='quoted' SET c.status='prepared',c.signature='synthetic-saved-signature',c.deadline=$now RETURN c", { now: Math.floor(Date.now()/1000) - 1 });
  await claims.reconcile('tutor-fixture');
  const expired = (await run("MATCH(c:TutorRewardClaim {status:'expired'}) RETURN c")).records;
  expect(expired.length).toBeGreaterThan(0);
  const q = await claims.quote('tutor-fixture', token, '12');
  const result = await claims.confirm('tutor-fixture', q.id); expect(result.status).toBe('queued');
});
it('concurrent confirmations never enqueue different authorized payloads for one quote', async () => {
  await claims.reconcile('tutor-fixture');
  const q = await claims.quote('tutor-fixture', token, '12');
  const before = submitted.length;
  const results = await Promise.allSettled([claims.confirm('tutor-fixture', q.id), claims.confirm('tutor-fixture', q.id)]);
  expect(results.some(r => r.status === 'fulfilled')).toBe(true);
  await claims.confirm('tutor-fixture', q.id);
  const attempts = submitted.slice(before);
  expect(attempts.length).toBeGreaterThan(0);
  for (const attempt of attempts) {
    expect(attempt[0]).toBe('claim:' + q.id); expect(attempt[2]).toEqual(attempts[0][2]);
  }
});
