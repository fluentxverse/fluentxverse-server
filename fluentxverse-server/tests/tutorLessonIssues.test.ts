import { describe, expect, test } from 'bun:test';
import { issueListOptions, issueBookingInPeriod, publicTutorIssue } from '../src/services/tutorLessonIssues.service';

const now = Date.parse('2026-10-14T08:00:00Z');
describe('tutor lesson issue list policy', () => {
  test('rejects invalid filters and unbounded or fractional pages', () => {
    for (const direction of ['all', '', 'admin']) expect(() => issueListOptions('all', undefined, direction)).toThrow();
    for (const status of ['', 'dismissed', 'banana']) expect(() => issueListOptions('all', undefined, 'sent', status)).toThrow();
    for (const page of [0, -1, 1.5, NaN, Infinity, 100001]) expect(() => issueListOptions('all', undefined, 'sent', 'all', page)).toThrow();
    expect(() => issueListOptions('invalid')).toThrow();
    expect(() => issueListOptions('month', '2026-11', 'sent', 'all', 1, now)).toThrow();
  });
  test('uses PHT lesson-date boundaries, not report submission dates', () => {
    const { window } = issueListOptions('month', '2026-10', 'sent', 'all', 1, now);
    expect(issueBookingInPeriod('2026-09-30T15:59:59Z', window)).toBe(false);
    expect(issueBookingInPeriod('2026-09-30T16:00:00Z', window)).toBe(true);
    expect(issueBookingInPeriod('2026-10-31T15:59:59Z', window)).toBe(true);
    expect(issueBookingInPeriod('2026-10-31T16:00:00Z', window)).toBe(false);
    expect(issueBookingInPeriod(null, window)).toBe(false);
    expect(issueBookingInPeriod(null, issueListOptions('all').window)).toBe(true);
    const rolling = issueListOptions('30days', undefined, 'received', 'resolved', 1, now).window;
    expect(issueBookingInPeriod(new Date(now - 30 * 86400000).toISOString(), rolling)).toBe(true);
    expect(issueBookingInPeriod(new Date(now).toISOString(), rolling)).toBe(false);
  });
  test('exposes only public fields and keeps student details and subtype labels', () => {
    const booking = { bookingId: 'owned', studentId: 'student', studentName: 'Student Name', startsAt: '2026-10-07T02:00:00Z' };
    const row = { id: 'report', direction: 'received', reason: 'tutor', tutor_issue: 'no_show', duration: 'over_ten',
      details: 'Public student description', review_status: 'resolved', resolution: 'Public resolution', created_at: '2026-10-07T03:00:00Z',
      reviewed_at: '2026-10-08T03:00:00Z', reviewed_by: 'PRIVATE', internal_history: ['PRIVATE'], review_history: ['PRIVATE'], assignee_id: 'PRIVATE' };
    const publicReport = publicTutorIssue(row, booking);
    expect(publicReport.issueLabel).toBe('Tutor did not join the classroom');
    expect(publicReport.details).toBe('Public student description');
    expect(publicReport.resolution).toBe('Public resolution');
    expect(JSON.stringify(publicReport)).not.toContain('PRIVATE');
    expect(publicTutorIssue({ ...row, direction: 'sent', reason: 'student', student_issue: 'late' }, booking)).toMatchObject({
      issueLabel: 'Student is late', details: '',
    });
    expect(publicTutorIssue({ ...row, tutor_issue: null, created_at: null }, booking)).toMatchObject({ issueLabel: null, createdAt: null });
  });
});
