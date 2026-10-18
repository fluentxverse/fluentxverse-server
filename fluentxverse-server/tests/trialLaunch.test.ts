import { afterEach, expect, test } from 'bun:test';
import { assertTrialAllowance, trialCanBeRestored, trialLaunchMode, trialLessonLimit } from '../src/services/schedule.services/trialPolicy';
import { privatePassMode, publicPassMode, requirePasses } from '../src/services/lessonPasses/policy';
const env = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
test('trial is the default, ignores pass activation and rejects invalid limits or modes', () => {
  delete process.env.LESSON_BOOKING_MODE; delete process.env.TRIAL_LESSON_LIMIT;
  process.env.LESSON_PASSES_ENABLED = 'true';
  expect(trialLaunchMode()).toBe(true); expect(privatePassMode()).toBe(false);
  expect(publicPassMode()).toEqual({ mode: 'trial', trialLessonLimit: 1 }); expect(requirePasses).toThrow('disabled');
  for (const value of ['0', '-1', 'unlimited', '1.5', '1000']) { process.env.TRIAL_LESSON_LIMIT = value; expect(trialLessonLimit).toThrow(); }
  process.env.LESSON_BOOKING_MODE = 'unknown'; expect(trialLaunchMode).toThrow();
});
test('allowance check uses the booking transaction and fails closed for missing counts', async () => {
  process.env.TRIAL_LESSON_LIMIT = '1';
  let used = 0; const calls: any[] = [], tx = { run: async (query: string, params: any) => { calls.push({ query, params }); return { records: [{ get: () => used }] }; } };
  await assertTrialAllowance(tx, 'student'); expect(calls[0].params).toEqual({ studentId: 'student' });
  used = 1; await expect(assertTrialAllowance(tx, 'student')).rejects.toThrow('used or reserved');
  used = NaN; await expect(assertTrialAllowance(tx, 'student')).rejects.toThrow('unavailable');
});
test('early student cancellations and support cancellations restore trials; late and incomplete records do not', () => {
  const booking = { paymentMethod: 'trial', status: 'cancelled', slotDateTime: '2026-10-14T03:00:00Z', cancelledAt: '2026-10-14T02:00:00Z', studentId: 'student', cancelledBy: 'student' };
  expect(trialCanBeRestored(booking)).toBe(true);
  expect(trialCanBeRestored({ ...booking, cancelledAt: '2026-10-14T02:00:01Z' })).toBe(false);
  expect(trialCanBeRestored({ ...booking, cancelledAt: '2026-10-14T02:59:00Z', cancelledBy: 'support' })).toBe(true);
  expect(trialCanBeRestored({ ...booking, cancelledAt: undefined })).toBe(false);
  expect(trialCanBeRestored({ ...booking, paymentMethod: 'erc1155' })).toBe(false);
});
