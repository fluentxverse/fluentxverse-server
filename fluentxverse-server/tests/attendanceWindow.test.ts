import { describe, expect, test } from 'bun:test';
import { attendanceDeadlineMs, attendanceStartMs, validateAttendanceWindow, validateAttendanceWithPresentNeighbors } from '../src/services/schedule.services/attendanceWindow';

const first = { date: '2026-10-01', time: '6:00 PM' };
const next = { date: '2026-10-01', time: '6:30 PM' };
const start = attendanceStartMs(first);

describe('tutor attendance window', () => {
  test('uses Philippine time and includes both boundaries', () => {
    expect(new Date(start).toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(() => validateAttendanceWindow([first], start - 35 * 60_000)).not.toThrow();
    expect(() => validateAttendanceWindow([first], start - 11 * 60_000)).not.toThrow();
    expect(() => validateAttendanceWindow([first], start - 35 * 60_000 - 1)).toThrow();
    expect(() => validateAttendanceWindow([first], start - 11 * 60_000 + 1)).toThrow();
  });

  test('permits adjacent slots in one update based on the first start', () => {
    expect(() => validateAttendanceWindow([next, first], start - 20 * 60_000)).not.toThrow();
    expect(() => validateAttendanceWindow([first, { date: first.date, time: '7:00 PM' }], start - 20 * 60_000)).toThrow(/consecutive/);
    expect(() => validateAttendanceWindow([first, first], start - 20 * 60_000)).toThrow(/consecutive/);
    expect(() => validateAttendanceWindow([first, { date: '2026-10-02', time: '6:30 PM' }], start - 20 * 60_000)).toThrow(/consecutive/);
  });

  test('a late booking does not extend the attendance deadline', () => {
    const bookedAtMs = start - 7 * 60_000;
    const late = { ...first, bookedAtMs };
    expect(attendanceDeadlineMs(start)).toBe(start - 11 * 60_000);
    expect(() => validateAttendanceWindow([late], start - 6 * 60_000)).toThrow();
    expect(() => validateAttendanceWindow([late], start - 2 * 60_000)).toThrow();
    expect(() => validateAttendanceWindow([first], start - 6 * 60_000)).toThrow();
    expect(() => validateAttendanceWindow([{ ...first, bookedAtMs: start - 5 * 60_000 }], start - 1)).toThrow();
  });

  test('permits Present on a consecutive slot after a confirmed Present slot', () => {
    const now = start - 20 * 60_000;
    const third = { date: first.date, time: '7:00 PM' };
    expect(() => validateAttendanceWithPresentNeighbors([next], [first], 'present', now)).not.toThrow();
    expect(() => validateAttendanceWithPresentNeighbors([third], [first, next], 'present', now)).not.toThrow();
    expect(() => validateAttendanceWithPresentNeighbors([next], [first], 'absent', now)).toThrow();
    expect(() => validateAttendanceWithPresentNeighbors([third], [first], 'present', now)).toThrow();
    expect(() => validateAttendanceWithPresentNeighbors([next], [first], 'present', start + 21 * 60_000)).toThrow();
  });

  test('rejects invalid dates and times', () => {
    expect(() => attendanceStartMs({ date: '2026-02-30', time: '6:00 PM' })).toThrow();
    expect(() => attendanceStartMs({ date: '2026-10-01', time: '13:00 PM' })).toThrow();
  });
});
