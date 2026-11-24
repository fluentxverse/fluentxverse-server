import { expect, test } from 'bun:test';
import { rewardMonth, usdMicros, rewardAmount, rewardLesson, rewardAddress, rewardTimestamp, rewardDigest } from '../src/services/tutorRewards/policy';
import { matchesRewardsRuntime, RewardsGateway, pin } from '../src/services/tutorRewards/gateway';
import artifact from '../../shared/tutorRewardsArtifact.json';

const now = Date.parse('2026-11-04T00:00:00Z');
const completed = { status: 'completed', slotDateTime: '2026-10-25T00:00:00Z', durationMinutes: 25, finalizedAt: '2026-10-28T00:00:00Z' };
test('USD values retain exact six decimal precision without floating point', () => {
  expect(usdMicros('0.000001')).toBe(1n);
  expect(usdMicros('0.2')).toBe(200_000n);
  expect(usdMicros('12345.123456')).toBe(12_345_123456n);
  for (const input of ['0', '-1', '.2', '01', '1e5', 'NaN', '0.0000001', '', 1, null, ' 1']) expect(() => usdMicros(input)).toThrow();
});
test('monthly eligibility rewards the first 60 retroactively and every additional lesson', () => {
  expect(rewardAmount(59, 60, 200_000n)).toBe(0n);
  expect(rewardAmount(60, 60, 200_000n)).toBe(12_000_000n);
  expect(rewardAmount(65, 60, 200_000n)).toBe(13_000_000n);
  expect(rewardAmount(30, 30, 1_000_000n)).toBe(30_000_000n);
  expect(() => rewardAmount(1.5, 60, 1n)).toThrow();
});
test('reward months use exclusive Manila calendar boundaries including year rollover and leap years', () => {
  expect(rewardMonth('2026-11')).toEqual({ month: '2026-11', periodId: 202611, startsAt: '2026-10-31T16:00:00.000Z', endsAt: '2026-11-30T16:00:00.000Z' });
  expect(rewardMonth('2026-12').endsAt).toBe('2026-12-31T16:00:00.000Z');
  expect(rewardMonth('2028-02').endsAt).toBe('2028-02-29T16:00:00.000Z');
  for (const m of ['2026-13', '2026-00', '2026-1', 'November', null]) expect(() => rewardMonth(m)).toThrow();
});
test('completed SYS-501 and student no-show lessons count without both-person attendance', () => {
  expect(rewardLesson(completed, [], false, now)).toBe('completed');
  expect(rewardLesson({ ...completed, penaltyCode: '501', attendanceStudent: 'absent', lessonOutcome: 'system_issue' }, [], false, now)).toBe('completed');
  expect(rewardLesson({ ...completed, penaltyCode: '502', attendanceStudent: 'absent', lessonOutcome: 'student_no_show' }, [], false, now)).toBe('completed');
});
test('both active TA-301 penalties and booking markers exclude even present completed lessons', () => {
  expect(rewardLesson({ ...completed, attendanceTutor: 'present' }, [], true, now)).toBe('excluded');
  for (const penaltyCode of ['301', 'TA-301']) expect(rewardLesson({ ...completed, penaltyCode }, [], false, now)).toBe('excluded');
});
test('unresolved and unassessed complaints hold totals; explicit tutor-favorable resolution qualifies', () => {
  expect(rewardLesson(completed, [{ status: 'submitted' }], false, now)).toBe('held');
  expect(rewardLesson(completed, [{ status: 'resolved' }], false, now)).toBe('held');
  expect(rewardLesson(completed, [{ status: 'resolved', decision: 'alternative_approved' }], false, now)).toBe('completed');
  expect(rewardLesson(completed, [{ status: 'resolved', decision: 'completion_rejected' }], false, now)).toBe('excluded');
  expect(rewardLesson(completed, [{ status: 'resolved', decision: 'completion_approved' }, { status: 'under_review' }], false, now)).toBe('held');
});
test('unfinalized, future and held bookings never silently become completed rewards', () => {
  for (const change of [{ status: 'confirmed' }, { finalizedAt: null }, { finalizedAt: 'invalid' }, { finalizedAt: '2027-01-01' },
    { finalizedAt: '2026-10-25T00:01:00Z' }, { disputeHold: true }, { compensationHold: true }, { durationMinutes: -1 }]) {
    expect(rewardLesson({ ...completed, ...change }, [], false, now)).toBe('held');
  }
});
test('token and release inputs are validated rather than silently normalized', () => {
  expect(rewardAddress(pin.operator)).toBe(pin.operator as `0x${string}`);
  for (const a of ['', '0x' + '0'.repeat(40), 'NVDA', '0x123']) expect(() => rewardAddress(a)).toThrow();
  expect(rewardTimestamp('2026-12-01T09:00:00+08:00')).toBe(Date.parse('2026-12-01T01:00:00Z') / 1000);
  expect(() => rewardTimestamp('2026-12-01T09:00')).toThrow();
});
test('runtime verification ignores only immutable reference slots, not executable code', () => {
  expect(matchesRewardsRuntime(artifact.runtime)).toBe(true);
  expect(matchesRewardsRuntime('0x')).toBe(false);
  const bytes = Buffer.from(artifact.runtime.slice(2), 'hex');
  for (const refs of Object.values(artifact.immutableReferences)) for (const r of refs) bytes.fill(0x11, r.start, r.start + r.length);
  expect(matchesRewardsRuntime('0x' + bytes.toString('hex'))).toBe(true);
  bytes[0] = bytes[0]! ^ 1;
  expect(matchesRewardsRuntime('0x' + bytes.toString('hex'))).toBe(false);
});
test('gateway rejects an RPC that answers for another chain', async () => {
  const gateway = new RewardsGateway({ getChainId: async () => 42161 });
  await expect(gateway.status()).rejects.toThrow('wrong network');
});
test('snapshot digests do not depend on database object property order', () => {
  expect(rewardDigest({ b: 2, a: { d: 4, c: 3 } })).toBe(rewardDigest({ a: { c: 3, d: 4 }, b: 2 }));
});
test('deployment finality checks work on non-archive RPCs without inventing finality', async () => {
  let codeReads = 0;
  const fake: any = {
    getChainId: async () => 4663, getBalance: async () => 123n,
    getCode: async (options: any) => { expect(options.blockNumber).toBeUndefined(); codeReads++; return artifact.runtime; },
    readContract: async (o: any) => ['owner', 'engine', 'claimRelayer', 'guardian'].includes(o.functionName) ? pin.operator
      : o.functionName === 'settlementToken' ? pin.settlementToken : o.functionName === 'maxQuoteAgeSeconds' ? 300
      : ['claimsPaused', 'allocationsPaused'].includes(o.functionName) ? true : 0n,
    getTransactionReceipt: async () => ({ status: 'success', contractAddress: pin.contract, blockNumber: 5n, blockHash: 'fixture-block' }),
    getBlock: async (o: any) => o.blockTag === 'finalized' ? { number: 4n } : { hash: 'fixture-block' },
  };
  const g = new RewardsGateway(fake);
  expect((await g.status()).finalized).toBe(false);
  fake.getBlock = async (o: any) => o.blockTag === 'finalized' ? { number: 6n } : { hash: 'fixture-block' };
  expect((await g.status()).finalized).toBe(true);
  expect(codeReads).toBe(2);
  fake.getBlock = async (o: any) => o.blockTag === 'finalized' ? { number: 6n } : { hash: 'reorged-block' };
  await expect(g.status()).rejects.toThrow('noncanonical');
});
test('missing deployment is reported as missing, not as an active rewards contract', async () => {
  const gateway = new RewardsGateway({ getChainId: async () => 4663, getCode: async () => undefined, getBalance: async () => 123n });
  const state = await gateway.status();
  expect(state.deployed).toBe(false); expect(state.finalized).toBe(false); expect(state.claimsPaused).toBe(true);
});
test('Engine enqueue uses a stable scoped idempotency key and sends no ETH value', async () => {
  const oldBase = process.env.TUTOR_REWARDS_ENGINE_API_BASE, oldKey = process.env.TUTOR_REWARDS_ENGINE_API_KEY;
  process.env.TUTOR_REWARDS_ENGINE_API_BASE = 'https://engine.example.test'; process.env.TUTOR_REWARDS_ENGINE_API_KEY = 'fixture-only';
  const payloads: any[] = [];
  let simulations = 0;
  try {
    const g = new RewardsGateway({ simulateContract: async () => { simulations++; } }, (async (_url: any, options: any) => {
      payloads.push(JSON.parse(options.body)); return Response.json({ transaction: { id: 'engine-fixture' } });
    }) as any);
    await g.submit('operation-fixture', 'finalizePeriod', ['202611']);
    await g.submit('operation-fixture', 'finalizePeriod', ['202611'], false, true);
    expect(payloads[0]).toEqual(payloads[1]); expect(simulations).toBe(1);
    expect(payloads[0].idempotencyKey).toBe(`tutor-rewards:4663:${pin.contract}:operation-fixture`);
    expect(payloads[0].contractAddress).toBe(pin.contract); expect(payloads[0].value).toBe('0');
  } finally {
    if (oldBase === undefined) delete process.env.TUTOR_REWARDS_ENGINE_API_BASE; else process.env.TUTOR_REWARDS_ENGINE_API_BASE = oldBase;
    if (oldKey === undefined) delete process.env.TUTOR_REWARDS_ENGINE_API_KEY; else process.env.TUTOR_REWARDS_ENGINE_API_KEY = oldKey;
  }
});
