import { describe, expect, test } from 'bun:test';
import { attendanceDeadlineMs } from '../src/services/schedule.services/attendanceWindow';
import {
  BOOKING_CUTOFF_MINUTES,
  SLOT_OPEN_LEAD_MINUTES,
  canOpenSlot,
  canReserveForBooking,
} from '../src/services/schedule.services/bookingPolicy';

describe('booking and attendance cutoffs', () => {
  const start = Date.parse('2026-10-03T10:00:00+08:00');
  const before = (minutes: number) => start - minutes * 60_000;

  test('unconfirmed slots close at eleven minutes; Present slots close after five minutes', () => {
    expect(BOOKING_CUTOFF_MINUTES).toBe(5);
    expect(canReserveForBooking(start, before(15))).toBe(true);
    expect(canReserveForBooking(start, before(11) - 1)).toBe(true);
    expect(canReserveForBooking(start, before(11))).toBe(false);
    expect(canReserveForBooking(start, before(10))).toBe(false);
    expect(canReserveForBooking(start, before(5), true)).toBe(true);
    expect(canReserveForBooking(start, before(5) + 1, true)).toBe(false);
  });

  test('a tutor can open a slot at least eleven minutes ahead', () => {
    expect(SLOT_OPEN_LEAD_MINUTES).toBe(11);
    expect(canOpenSlot(start, before(11) - 1)).toBe(true);
    expect(canOpenSlot(start, before(11))).toBe(true);
    expect(canOpenSlot(start, before(11) + 1)).toBe(false);
  });

  test('attendance deadline is fixed at eleven minutes before class', () => {
    expect(attendanceDeadlineMs(start)).toBe(before(11));
  });
});
