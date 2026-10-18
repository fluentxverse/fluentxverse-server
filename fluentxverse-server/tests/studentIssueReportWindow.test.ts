import { describe, expect, test } from 'bun:test';
import { studentIssueReportWindow } from '../src/services/studentLessonIssueReport.service';

const start = Date.parse('2026-10-08T06:00:00Z');
const at = (minutes: number, joined = false, status = 'confirmed', duration = 25) =>
  studentIssueReportWindow(new Date(start).toISOString(), duration, status, start + minutes * 60000, joined);

describe('student issue reporting availability', () => {
  test('cannot report before start or in the first three minutes', () => {
    expect(at(-1).reason).toBe('not_started');
    expect(at(0).eligible).toBe(false);
    expect(at(2.999).reason).toBe('waiting_for_tutor');
  });
  test('after three minutes, reporting requires no tutor classroom entry', () => {
    expect(at(3).eligible).toBe(true);
    expect(at(24.999).eligible).toBe(true);
    expect(at(3, true).reason).toBe('tutor_joined');
    expect(at(24, true).eligible).toBe(false);
    expect(studentIssueReportWindow(new Date(start).toISOString(), 25, 'confirmed', start + 4 * 60000).eligible).toBe(false);
  });
  test('all issues can be reported after the scheduled end, regardless of tutor presence', () => {
    for (const joined of [true, false]) {
      expect(at(25, joined).eligible).toBe(true);
      expect(at(25 + 48 * 60 - 0.001, joined, 'completed').eligible).toBe(true);
      expect(at(25 + 48 * 60, joined, 'completed').reason).toBe('expired');
    }
    expect(at(25, true, 'confirmed', 50).eligible).toBe(false);
    expect(at(50, true, 'confirmed', 50).eligible).toBe(true);
  });
  test('a continuous tutor departure opens reporting at exactly 60 seconds', () => {
    const left = start + 10 * 60000;
    const window = (now: number, leftAt: number | null = left) => studentIssueReportWindow(new Date(start).toISOString(), 25, 'confirmed', now, true, leftAt);
    expect(window(left + 59999).reason).toBe('tutor_disconnected_wait');
    expect(window(left + 59999).eligible).toBe(false);
    expect(window(left + 60000).eligible).toBe(true);
    expect(window(left + 60000).duringLessonTutorIssue).toBe('left_early');
    expect(window(left + 60000).availableAt).toBe(new Date(left + 60000).toISOString());
    expect(window(left + 60000, null).reason).toBe('tutor_joined');
    expect(window(left + 60000, left + 30000).eligible).toBe(false);
    expect(window(start + 2 * 60000, start + 60000).eligible).toBe(true);
    expect(window(start + 2 * 60000, start - 1).eligible).toBe(false);
    expect(window(start + 26 * 60000).eligible).toBe(true);
  });
  test('cancelled lessons are never eligible', () => {
    for (const minutes of [0, 4, 25, 60]) expect(at(minutes, false, 'cancelled').eligible).toBe(false);
  });
});
