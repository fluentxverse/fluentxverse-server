import { describe, expect, test } from 'bun:test';
import {
  isShortNoticeCancellation, validateAbsenceTime, validateReopenPolicy
} from '../src/services/schedule.services/cancellationPolicy';
import { determinePenaltyCode, PenaltyCode } from '../src/config/penaltyCodes';

const slotStartMs = Date.parse('2026-10-02T10:00:00Z'); // 6 PM PHT
const slotDate = '2026-10-02';

describe('TA-303 cancellation policy', () => {
  test('only unbooked cancellations under 48 hours meet the short-notice threshold', () => {
    expect(isShortNoticeCancellation(slotStartMs, slotStartMs - 48 * 60 * 60_000)).toBe(false);
    expect(isShortNoticeCancellation(slotStartMs, slotStartMs - 48 * 60 * 60_000 + 1)).toBe(true);
    expect(determinePenaltyCode({ wasBooked: false, tutorPresent: false, cancellationNoticeHours: 47 })).toBe(PenaltyCode.TA_SHORT_NOTICE);
    expect(determinePenaltyCode({ wasBooked: false, tutorPresent: false, cancellationNoticeHours: 48 })).toBe(null);
  });

  test('an unbooked slot can be cancelled through the eleven-minute cutoff', () => {
    expect(() => validateAbsenceTime(slotStartMs, slotStartMs - 11 * 60_000)).not.toThrow();
    expect(() => validateAbsenceTime(slotStartMs, slotStartMs - 11 * 60_000 + 1)).toThrow();
  });

  test('same-day TA-303 requires thirty minutes and allows one reopening', () => {
    const penaltyMs = slotStartMs - 90 * 60_000;
    const base = { slotDate, lastPenaltyMs: penaltyMs, penaltyCount: 1, reopenCount: 0 };
    expect(() => validateReopenPolicy({ ...base, nowMs: penaltyMs + 29 * 60_000 })).toThrow(/30 minutes/);
    expect(() => validateReopenPolicy({ ...base, nowMs: penaltyMs + 30 * 60_000 })).not.toThrow();
    expect(() => validateReopenPolicy({ ...base, nowMs: penaltyMs + 30 * 60_000, reopenCount: 1 })).toThrow(/one reopening/);
    expect(() => validateReopenPolicy({ ...base, nowMs: penaltyMs + 30 * 60_000, penaltyCount: 2 })).toThrow(/one reopening/);
  });

  test('prior-day TA-303 waits until lesson day', () => {
    const penaltyMs = slotStartMs - 30 * 60 * 60_000;
    const base = { slotDate, lastPenaltyMs: penaltyMs, penaltyCount: 1, reopenCount: 0 };
    expect(() => validateReopenPolicy({ ...base, nowMs: penaltyMs + 31 * 60_000 })).toThrow(/lesson day/);
    expect(() => validateReopenPolicy({ ...base, nowMs: slotStartMs - 5 * 60 * 60_000 })).not.toThrow();
    expect(() => validateReopenPolicy({ ...base, nowMs: slotStartMs - 5 * 60 * 60_000, penaltyCount: 0 })).not.toThrow();
  });
});
