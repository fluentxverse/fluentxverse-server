import { describe, expect, test } from 'bun:test';
import { adminCapabilities, operationsDates, requiredReason } from '../src/utils/adminOperations';
import { lessonNotesEditWindow } from '../src/utils/lessonNotesEditWindow';
import { calculateTutorPerformance, performanceWindow } from '../src/utils/tutorPerformance';
describe('admin operations policy', () => {
  test('legacy admins keep access, explicit capabilities restrict it, superadmin always has all', () => {
    expect(adminCapabilities({ role: 'admin' })).toHaveLength(4);
    expect(adminCapabilities({ role: 'admin', permissions: ['qa', 'invalid'] })).toEqual(['qa']);
    expect(adminCapabilities({ permissions: [] })).toEqual([]);
    expect(adminCapabilities({ role: 'superadmin', permissions: [] })).toHaveLength(4);
  });
  test('PHT day includes evening UTC and date ranges are bounded and strict', () => {
    expect(operationsDates('2026-10-09').from).toBe('2026-10-08T16:00:00.000Z');
    expect(operationsDates('2026-10-09').to).toBe('2026-10-09T16:00:00.000Z');
    expect(() => operationsDates('2026-02-30')).toThrow();
    expect(() => operationsDates('2025-01-01', '2026-10-09')).toThrow();
    expect(() => operationsDates('2026-10-09', '2026-10-08')).toThrow();
  });
  test('all manual changes require a nonblank bounded reason', () => {
    expect(requiredReason('  Evidence checked  ')).toBe('Evidence checked');
    expect(() => requiredReason('  ')).toThrow();
    expect(() => requiredReason('a'.repeat(1001))).toThrow();
  });
  test('reopened editing never permits cancelled or not-started lessons', () => {
    const start = '2026-10-01T08:00:00Z', now = Date.parse('2026-10-09T08:00:00Z'), until = '2026-10-10T08:00:00Z';
    expect(lessonNotesEditWindow(start, 25, 'completed', now).canEdit).toBe(false);
    expect(lessonNotesEditWindow(start, 25, 'completed', now, until).canEdit).toBe(true);
    expect(lessonNotesEditWindow(start, 25, 'cancelled', now, until).canEdit).toBe(false);
    expect(lessonNotesEditWindow('2026-10-10T08:00:00Z', 25, 'confirmed', now, until).canEdit).toBe(false);
    expect(lessonNotesEditWindow(start, 25, 'completed', Date.parse(until), until).canEdit).toBe(false);
  });
  test('reopened notes stop being overdue but never convert late submissions to on-time', () => {
    const now = Date.parse('2026-10-09T08:00:00Z');
    const b = { bookingId: 'x', slotDateTime: '2026-10-01T08:00:00Z', durationMinutes: 25, status: 'completed', attendanceTutor: 'present', notesReopenedUntil: '2026-10-10T08:00:00Z' };
    const calc = (fields = {}) => calculateTutorPerformance([{ ...b, ...fields }], [], [], {}, performanceWindow('all', undefined, now), now);
    expect(calc().notes.overdue).toBe(0);
    expect(calc({ notesReopenedUntil: null }).notes.overdue).toBe(1);
    expect(calc({ notesSubmittedAt: '2026-10-09T07:00:00Z' }).notes.onTime).toBe(0);
  });
});
