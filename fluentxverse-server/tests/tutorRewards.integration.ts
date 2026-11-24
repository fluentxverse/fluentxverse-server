import { afterAll, expect, mock, test } from 'bun:test';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';

const uri = process.env.REWARDS_TEST_MEMGRAPH_URI;
const it = uri ? test : test.skip;
let submitted: any[] = [], reportRows: any[] = [], uncertain = false;
const allocations = new Map<string, any>();
const period = [BigInt(Date.parse('2026-10-01T00:00:00+08:00') / 1000), BigInt(Date.parse('2026-11-01T00:00:00+08:00') / 1000), 1n, 60, 200_000n, false, 0n];
const wallet = '0x1111111111111111111111111111111111111111';
const gateway: any = {
  configured: () => true,
  status: async () => ({ deployed: true, finalized: true, allocationsPaused: false, operatorGasWei: '1' }),
  assertWritable: async () => ({ deployed: true, finalized: true, allocationsPaused: false }),
  read: async (fn: string, args: any[]) => fn === 'periods' ? period : fn === 'tutorWallets' ? wallet : fn === 'allocations' ? allocations.get(args[1]) || [0, 0n, false] : 0n,
  submit: async (...args: any[]) => { submitted.push(args); if (uncertain) { uncertain = false; throw Error('fixture uncertain response'); } return 'engine-' + args[0]; },
};
mock.module('../src/db/postgres', () => ({ db: { array: (ids: string[], type: string) => ({ ids, type }) }, query: async (sql: string, params: any[]) => {
  expect(sql.match(/to_jsonb\(r\)->>'completion_decision' AS completion_decision/g)).toHaveLength(2);
  expect(params[0].type).toBe('TEXT');
  expect(Array.isArray(params[0].ids)).toBe(true);
  return { rows: reportRows };
} }));
mock.module('../src/services/tutorRewards/gateway', () => ({ pin: { chainId: 4663, contract: '0x2222222222222222222222222222222222222222' }, rewardsGateway: gateway,
  rewardsAbi: [], settlementAbi: [], matchesContractRuntime: () => false, jsonSafe: (v: any) => v }));
const { tutorRewardsService: service, ensureRewardsSchema } = await import('../src/services/tutorRewards/service');
async function run(cypher: string, params: any = {}) { const s = getDriver().session(); try { return await s.run(cypher, params); } finally { await s.close(); } }
if (uri) {
  if (!['bolt://127.0.0.1:17733', 'bolt://127.0.0.1:17735'].includes(uri)) throw Error('Only a dedicated disposable rewards graph is allowed.');
  await initDriver(uri, '', '', 1); await run('MATCH(n) DETACH DELETE n'); await ensureRewardsSchema();
}
afterAll(async () => { if (uri) await closeDriver(); });

it('real graph staging counts no-shows and SYS-501, excludes TA-301 and blocks unresolved reports', async () => {
  await run(`CREATE(:Admin {id:'rewards-fixture-admin',role:'superadmin'})
    CREATE(:User {id:'rewards-fixture-tutor',givenName:'Synthetic',familyName:'Tutor',smartWalletAddress:$wallet})`,
    { wallet: { userId: 'rewards-fixture-tutor', address: wallet, smartAccountAddress: wallet } });
  for (let i = 0; i < 62; i++) await run(`CREATE(:Booking {bookingId:$id,tutorId:'rewards-fixture-tutor',status:'completed',
    slotDateTime:datetime('2026-10-10T01:00:00Z'),durationMinutes:25,finalizedAt:'2026-10-13T01:00:00Z',
    attendanceStudent:'absent',penaltyCode:$code})`, { id: 'rewards-fixture-' + i, code: i === 61 ? '301' : i === 60 ? '501' : '502' });
  let preview = await service.preview('2026-10');
  expect(preview.rows[0]!.completedLessons).toBe(61);
  expect(preview.rows[0]!.excludedLessons).toBe(1);
  expect(preview.rows[0]!.wallet).toBe(wallet);
  const req = { action: 'register_tutor' as const, requestId: crypto.randomUUID(), reason: 'Synthetic wallet registration', params: { tutorId: 'rewards-fixture-tutor' } };
  const registered = await service.command(req, 'rewards-fixture-admin');
  expect(registered.status).toBe('queued');
  expect(submitted[0][1]).toBe('registerTutor');
  expect(submitted[0][2][1]).toBe(wallet);
  const stable = submitted[0][2][0];
  await service.command(req, 'rewards-fixture-admin');
  expect(submitted.length).toBe(1);
  preview = await service.preview('2026-10');
  expect(preview.rows[0]!.publicId).toBe(stable);
  expect(preview.canStage).toBe(true);
  expect(preview.totalUsd).toBe('12200000');
  reportRows = [{ booking_id: 'rewards-fixture-0', review_status: 'submitted', completion_decision: null }];
  const held = await service.preview('2026-10');
  expect(held.heldLessons).toBe(1); expect(held.canStage).toBe(false);
  await expect(service.command({ action: 'stage_counts', requestId: crypto.randomUUID(), reason: 'Stale snapshot fixture', params: { month: '2026-10', snapshotDigest: preview.snapshotDigest } }, 'rewards-fixture-admin')).rejects.toThrow('totals changed');
  reportRows[0].review_status = 'resolved';
  const legacy = await service.preview('2026-10');
  expect(legacy.heldLessons).toBe(1); expect(legacy.canStage).toBe(false);
  reportRows[0].completion_decision = 'alternative_approved';
  const cleared = await service.preview('2026-10');
  expect(cleared.rows[0]!.completedLessons).toBe(61);
  const stage = { action: 'stage_counts' as const, requestId: crypto.randomUUID(), reason: 'Synthetic reconciled month', params: { month: '2026-10', snapshotDigest: cleared.snapshotDigest, offset: 0 } };
  uncertain = true;
  await expect(service.command(stage, 'rewards-fixture-admin')).rejects.toThrow('uncertain');
  const queued = await service.command(stage, 'rewards-fixture-admin');
  expect(queued.status).toBe('queued');
  expect(submitted.at(-1)[0]).toBe(submitted.at(-2)[0]);
  expect(submitted.at(-1)[4]).toBe(true);
  expect(submitted.at(-1)[2]).toEqual(['202610', [{ tutorId: stable, completedLessons: 61 }]]);
  await expect(service.command({ ...stage, reason: 'Changed intent' }, 'rewards-fixture-admin')).rejects.toThrow('different reward operation');
  expect((await service.preview('2026-10')).canFinalize).toBe(false);
  allocations.set(stable, [61, 12_200_000n, false]); period[6] = 12_200_000n;
  expect((await service.preview('2026-10')).canFinalize).toBe(true);
  await run("MATCH(b:Booking {tutorId:'rewards-fixture-tutor'}) SET b.penaltyCode='301'");
  const correction = await service.preview('2026-10');
  expect(correction.rows[0]!.completedLessons).toBe(0);
  expect(correction.canStage).toBe(true);
  expect(correction.canFinalize).toBe(false);
  await service.command({ action: 'stage_counts', requestId: crypto.randomUUID(), reason: 'Correct staged counts to zero', params: { month: '2026-10', snapshotDigest: correction.snapshotDigest, offset: 0 } }, 'rewards-fixture-admin');
  expect(submitted.at(-1)[2][1][0].completedLessons).toBe(0);
  await run("MATCH(b:Booking {tutorId:'rewards-fixture-tutor'}) DETACH DELETE b");
  expect((await service.preview('2026-10')).rows).toHaveLength(1);
  period[5] = true;
  const frozen = await service.preview('2026-10');
  expect(frozen.rows[0]!.completedLessons).toBe(61);
  expect(frozen.rows[0]!.amountUsd).toBe('12200000');
  expect(frozen.rows[0]!.wallet).toBe(wallet);
});
