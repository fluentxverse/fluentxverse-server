import { expect, test } from 'bun:test';
import { payableCompletion, payoutReservation, PAYOUT_POLICY } from '../src/services/admin.services/tutorEarnings.service';

const completed = { status: 'completed', lessonOutcome: 'attended', attendanceTutor: 'present', attendanceStudent: 'present', finalizedAt: '2026-01-01T00:00:00.000Z', slotDateTime: '2025-12-31T23:35:00.000Z', durationMinutes: 25 };
test('only authorized finalized, attended, non-refunded lessons are payable', () => {
  expect(payableCompletion(completed)).toBe(completed.finalizedAt);
  for (const patch of [{ status: 'confirmed' }, { status: 'cancelled' }, { attendanceTutor: 'absent' }, { attendanceStudent: 'absent' },
    { lessonOutcome: 'awaiting_verification' }, { finalizedAt: '' }, { finalizedAt: 'invalid' }, { finalizedAt: '2099-01-01T00:00:00.000Z' },
    { refunded: true }, { refundApprovedBy: 'finance' }, { refundStatus: 'pending' }, { refundStatus: 'review' }, { compensationHold: true },
    { slotDateTime: '2099-01-01T00:00:00.000Z' }, { slotDateTime: '' }, { durationMinutes: -1 }, { durationMinutes: 181 }]) {
    expect(() => payableCompletion({ ...completed, ...patch })).toThrow();
  }
});
test('payout reservation requests are exact, bounded and canonical', () => {
  const input = { requestId: crypto.randomUUID(), bookingIds: ['lesson-b', 'lesson-a'], recipient: `0x${'aB'.repeat(20)}`, reason: ' Approved payable records ' };
  expect(payoutReservation(input)).toEqual({ ...input, recipient: input.recipient.toLowerCase(), bookingIds: ['lesson-a', 'lesson-b'], reason: 'Approved payable records' });
  for (const patch of [{ bookingIds: [] }, { bookingIds: Array(5).fill('a') }, { bookingIds: ['a', 'a'] }, { bookingIds: ['../student'] },
    { requestId: 'not-a-request' }, { recipient: `0x${'0'.repeat(40)}` }, { recipient: 'bad' }, { reason: '' }, { feeCents: 1 }, { proof: {} }]) {
    expect(() => payoutReservation({ ...input, ...patch } as any)).toThrow();
  }
  expect(PAYOUT_POLICY).toBe('fluentxverse.usd-earnings.v1.zero-fee');
});
