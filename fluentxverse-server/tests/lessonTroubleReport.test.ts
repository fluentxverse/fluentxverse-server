import { describe, expect, test } from 'bun:test';
import { getLessonTroubleWindow, isLessonTroubleWindowOpen, LessonTroubleReportService } from '../src/services/lessonTroubleReport.service';
import { query } from '../src/db/postgres';
import { tutorStudentIssueLabel, validateTutorStudentIssue } from '../src/utils/tutorStudentIssues';

describe('tutor student-related issue validation', () => {
  test('requires a recognized student issue only for student-related reports', () => {
    for (const issue of ['asked_to_cancel', 'late']) {
      expect(() => validateTutorStudentIssue('student', issue)).not.toThrow();
      expect(tutorStudentIssueLabel(issue)).toBeTruthy();
      expect(() => validateTutorStudentIssue('audio', issue)).toThrow('only be selected');
    }
    for (const issue of [undefined, null, '', 'other', 'toString']) {
      expect(() => validateTutorStudentIssue('student', issue)).toThrow('Choose what happened');
    }
    expect(() => validateTutorStudentIssue('audio')).not.toThrow();
    expect(tutorStudentIssueLabel('asked_to_cancel')).toBe('Student asked to cancel');
    expect(tutorStudentIssueLabel('late')).toBe('Student is late');
    expect(tutorStudentIssueLabel(null)).toBeNull();
  });
});

describe('lesson trouble reporting window', () => {
  test('opens at the lesson start and closes at its end', () => {
    const window = getLessonTroubleWindow('2026-10-05', '11:30 PM', 25);
    expect(window).toEqual({
      startsAt: '2026-10-05T15:30:00.000Z',
      endsAt: '2026-10-05T15:55:00.000Z'
    });
    expect(isLessonTroubleWindowOpen(window, Date.parse(window.startsAt) - 1)).toBe(false);
    expect(isLessonTroubleWindowOpen(window, Date.parse(window.startsAt))).toBe(true);
    expect(isLessonTroubleWindowOpen(window, Date.parse(window.endsAt) - 1)).toBe(true);
    expect(isLessonTroubleWindowOpen(window, Date.parse(window.endsAt))).toBe(false);
  });

  test('handles a lesson that crosses midnight in Philippine time', () => {
    const window = getLessonTroubleWindow('2026-10-05', '11:50 PM', 25);
    expect(window.endsAt).toBe('2026-10-05T16:15:00.000Z');
  });

  test('rejects an invalid schedule', () => {
    expect(() => getLessonTroubleWindow('2026-10-05', '25:00 PM', 25)).toThrow('Invalid lesson schedule');
    expect(() => getLessonTroubleWindow('2026-10-05', '1:00 PM', 0)).toThrow('Invalid lesson schedule');
  });
});

const integration = process.env.LESSON_NOTES_TEST_URI ? describe : describe.skip;
integration('tutor issue report duplicate protection (local PostgreSQL)', () => {
  test('persists both student issues and reads legacy reports without a subtype', async () => {
    const service = new LessonTroubleReportService();
    const ids = ['asked_to_cancel', 'late', 'legacy'].map(() => `tutor-student-test-${crypto.randomUUID()}`);
    try {
      for (const [index, issue] of (['asked_to_cancel', 'late'] as const).entries()) {
        const saved = await service.create(ids[index]!, 'test-only-tutor', 'up_to_ten', 'student', issue);
        expect(saved?.studentIssue).toBe(issue);
        expect((await service.getByBooking(ids[index]!))?.studentIssueLabel).toBe(tutorStudentIssueLabel(issue));
        expect(await service.create(ids[index]!, 'test-only-tutor', 'over_ten', 'audio')).toBeNull();
      }
      await query(`INSERT INTO lesson_trouble_reports (id, booking_id, tutor_id, duration, reason)
        VALUES ($1, $2, 'test-only-tutor', 'up_to_ten', 'student')`, [crypto.randomUUID(), ids[2]]);
      expect((await service.getByBooking(ids[2]!))?.studentIssueLabel).toBeNull();
      await expect(service.create('invalid-not-written', 'test-only-tutor', 'up_to_ten', 'student')).rejects.toThrow('Choose what happened');
    } finally {
      for (const id of ids) await query('DELETE FROM lesson_trouble_reports WHERE booking_id = $1', [id]);
    }
  });
  test('simultaneous submissions keep exactly one immutable report per booking', async () => {
    const bookingId = `tutor-report-race-test-${crypto.randomUUID()}`;
    const service = new LessonTroubleReportService();
    try {
      const results = await Promise.all([
        service.create(bookingId, 'test-only-tutor', 'up_to_ten', 'audio'),
        service.create(bookingId, 'test-only-tutor', 'over_ten', 'connection'),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const saved = await service.getByBooking(bookingId);
      expect(saved?.id).toBe(results.find(Boolean)!.id);
      expect(saved?.reason).toBe(results.find(Boolean)!.reason);
      expect(await service.create(bookingId, 'test-only-tutor', 'over_ten', 'power')).toBeNull();
      expect((await service.getByBooking(bookingId))?.reason).toBe(saved?.reason);
    } finally { await query('DELETE FROM lesson_trouble_reports WHERE booking_id = $1', [bookingId]); }
  });
});
