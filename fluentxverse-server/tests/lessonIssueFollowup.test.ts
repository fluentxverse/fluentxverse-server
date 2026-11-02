import { test, expect } from 'bun:test';
import { EXPLANATION_WINDOW_MS, explanationExpired, followupMessage, replyText } from '../src/services/lessonIssueFollowup.policy';
import { validateTutorStudentIssue } from '../src/utils/tutorStudentIssues';
test('Other is a student-related choice only', () => {
  expect(() => validateTutorStudentIssue('student', 'other')).not.toThrow();
  expect(() => validateTutorStudentIssue('audio', 'other')).toThrow();
  expect(() => validateTutorStudentIssue('student')).toThrow();
});
test('24-hour deadline rejects at the exact boundary, not before', () => {
  const start = Date.parse('2026-10-30T10:00:00.000Z'), deadline = new Date(start + EXPLANATION_WINDOW_MS).toISOString();
  expect(explanationExpired(deadline, start + EXPLANATION_WINDOW_MS - 1)).toBe(false);
  expect(explanationExpired(deadline, start + EXPLANATION_WINDOW_MS)).toBe(true);
  expect(() => explanationExpired('bad', start)).toThrow();
});
test('message identifies lesson and warning with explicit timezone', () => {
  const message = followupMessage('2026-10-30T10:00:00.000Z', 25, '2026-10-31T10:00:00.000Z');
  expect(message).toContain('Friday'); expect(message).toContain('6:00 PM'); expect(message).toContain('6:25 PM');
  expect(message).toContain('TA-301'); expect(message).toContain('24 hours'); expect(message).toContain('UTC+08:00');
});
test('empty or excessively long replies cannot satisfy the explanation requirement', () => {
  expect(() => replyText('          ')).toThrow(); expect(() => replyText('x'.repeat(2001))).toThrow();
  expect(replyText('  The student requested a different time.  ')).toBe('The student requested a different time.');
});
