import { describe, expect, test } from 'bun:test';
import { surveyWindow, validateLessonSurvey, summarizeLessonSurveys } from '../src/utils/lessonSurvey';
import { calculateTutorPerformance, performanceWindow } from '../src/utils/tutorPerformance';

const end = Date.parse('2026-10-08T08:25:00Z');
const booking = { bookingId: 'lesson', slotDateTime: '2026-10-08T08:00:00Z', durationMinutes: 25, status: 'confirmed' };
describe('lesson surveys', () => {
  test('available only after the end and before the exact 48-hour deadline', () => {
    expect(surveyWindow(booking, end - 1).reason).toBe('not_ended');
    expect(surveyWindow(booking, end).eligible).toBe(true);
    expect(surveyWindow(booking, end + 48 * 3600_000 - 1).eligible).toBe(true);
    expect(surveyWindow(booking, end + 48 * 3600_000).reason).toBe('closed');
    expect(surveyWindow({ ...booking, status: 'cancelled' }, end).eligible).toBe(false);
    expect(surveyWindow({ ...booking, status: 'pending' }, end).eligible).toBe(false);
    expect(surveyWindow({ ...booking, attendanceStudent: 'absent' }, end).reason).toBe('absent');
    expect(surveyWindow({ ...booking, slotDateTime: 'invalid' }, end).closesAt).toBeNull();
  });
  test('ratings are required; topics and comments are optional and normalized', () => {
    expect(validateLessonSurvey({ rating: 5 })).toEqual({ rating: 5, positive: [], improvement: [], comment: '' });
    expect(validateLessonSurvey({ rating: 3, positive: ['pace', 'pace'], improvement: ['connection'], comment: ' Nice pace ' }))
      .toEqual({ rating: 3, positive: ['pace'], improvement: ['connection'], comment: 'Nice pace' });
    for (const rating of [0, 6, 2.5, '5', null]) expect(() => validateLessonSurvey({ rating })).toThrow();
    expect(() => validateLessonSurvey(null)).toThrow();
  });
  test('server-recorded tutor completion opens surveys early without changing the deadline', () => {
    const now = end - 5 * 60_000;
    expect(surveyWindow(booking, now).eligible).toBe(false);
    expect(surveyWindow({ ...booking, surveyReadyAt: new Date(now).toISOString() }, now)).toMatchObject({
      eligible: true, closesAt: new Date(end + 48 * 3600_000).toISOString(),
    });
    expect(surveyWindow({ ...booking, surveyReadyAt: '2026-10-08T07:59:00Z' }, now).eligible).toBe(false);
    expect(surveyWindow({ ...booking, surveyReadyAt: new Date(now + 1).toISOString() }, now).eligible).toBe(false);
    expect(surveyWindow({ ...booking, status: 'cancelled', surveyReadyAt: new Date(now).toISOString() }, now).eligible).toBe(false);
  });
  test('rejects unsupported, contradictory and malformed choices', () => {
    for (const value of [
      { positive: ['unknown'] }, { positive: ['start_time'] }, { improvement: ['unknown'] },
      { positive: ['connection'], improvement: ['connection'] }, { positive: 'pace' },
      { comment: 'a'.repeat(501) }, { comment: 5 },
    ]) expect(() => validateLessonSurvey({ rating: 4, ...value })).toThrow();
    expect(validateLessonSurvey({ rating: 4, positive: ['other'], improvement: ['other'] }).positive).toEqual(['other']);
  });
  test('aggregates actual survey counts, never includes comments or identities', () => {
    const summary = summarizeLessonSurveys([
      { rating: 5, positive: ['connection', 'connection', 'pace'], improvement: [], comment: 'Private', studentId: 'private' },
      { rating: 2, positive: [], improvement: ['connection'] }, { rating: 4, positive: [], improvement: ['pace'] },
    ]);
    expect(summary.total).toBe(3); expect(summary.average).toBe(3.7);
    expect(summary.topics.find(t => t.id === 'connection')).toMatchObject({ positive: 1, improvement: 1, positiveRate: 33.3, improvementRate: 33.3 });
    expect(summary.distribution.find(d => d.rating === 5)?.count).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('Private');
    expect(summarizeLessonSurveys([]).average).toBeNull();
    expect(summarizeLessonSurveys([]).topics[0]?.positiveRate).toBeNull();
  });
  test('metrics use scheduled lesson period, exclude future and unrelated surveys', () => {
    const now = Date.parse('2026-10-10T00:00:00Z');
    const result = calculateTutorPerformance([booking,
      { ...booking, bookingId: 'outside', slotDateTime: '2026-09-30T10:00:00Z' },
      { ...booking, bookingId: 'future', slotDateTime: '2026-10-11T08:00:00Z' },
    ], [], [], {}, performanceWindow('month', '2026-10', now), now, 1, [
      { bookingId: 'lesson', rating: 5, positive: ['feedback'], submittedAt: '2026-11-01' },
      { bookingId: 'outside', rating: 1 }, { bookingId: 'future', rating: 1 }, { bookingId: 'unlinked', rating: 1 },
    ]);
    expect(result.survey.total).toBe(1); expect(result.survey.average).toBe(5);
  });
  test('early feedback appears immediately without adding teaching hours', () => {
    const now = end - 10 * 60_000;
    const result = calculateTutorPerformance([booking], [], [], {}, performanceWindow('month', '2026-10', now), now, 1, [
      { bookingId: 'lesson', rating: 4, submittedAt: new Date(now).toISOString() },
    ]);
    expect(result.survey.total).toBe(1);
    expect(result.survey.average).toBe(4);
    expect(result.lessons.teachingHours).toBe(0);
  });
});
