import { getDriver } from '../db/memgraph';
import { invalidateCache } from '../db/redis';
import { StudentLessonAccessError } from './studentLesson.service';
import { LESSON_SURVEY_TOPICS, LessonSurveyError, surveyWindow, validateLessonSurvey } from '../utils/lessonSurvey';

function response(survey: Record<string, any> | undefined) {
  return survey ? { rating: Number(survey.rating), positive: survey.positive || [], improvement: survey.improvement || [],
    comment: survey.comment || '', submittedAt: survey.submittedAt } : null;
}

export class LessonSurveyService {
  private static schemaPromise: Promise<void> | null = null;
  private async ensureSchema() {
    if (!LessonSurveyService.schemaPromise) {
      LessonSurveyService.schemaPromise = (async () => {
        const session = getDriver().session();
        try {
          await session.run('CREATE CONSTRAINT ON (s:LessonSurvey) ASSERT s.bookingId IS UNIQUE');
          await session.run('CREATE INDEX ON :LessonSurvey(bookingId)');
          await session.run('CREATE INDEX ON :LessonSurvey(tutorId)');
        } finally { await session.close(); }
      })().catch(error => { LessonSurveyService.schemaPromise = null; throw error; });
    }
    await LessonSurveyService.schemaPromise;
  }

  async get(bookingId: string, studentId: string) {
    await this.ensureSchema();
    const session = getDriver().session();
    try {
      const result = await session.run(`MATCH (b:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(:Student {id: $studentId})
        OPTIONAL MATCH (s:LessonSurvey {bookingId: $bookingId}) RETURN b, s`, { bookingId, studentId });
      if (!result.records.length) throw new StudentLessonAccessError('Lesson not found or you do not have access to this lesson');
      const record = result.records[0]!, survey = response(record.get('s')?.properties);
      const window = surveyWindow(record.get('b').properties);
      return { ...window, eligible: window.eligible && !survey, reason: survey ? 'submitted' : window.reason, survey, topics: LESSON_SURVEY_TOPICS };
    } finally { await session.close(); }
  }

  async markReady(bookingId: string, tutorId: string, reason: 'ended' | 'left' = 'ended') {
    const session = getDriver().session();
    try {
      // Survey readiness does not change the scheduled end or attendance outcome.
      const result = await session.run(`MATCH (b:Booking {bookingId: $bookingId, tutorId: $tutorId})
        WHERE b.status IN ['confirmed', 'completed'] AND b.slotDateTime <= datetime()
          AND (b.attendanceStudent IS NULL OR b.attendanceStudent <> 'absent')
        SET b.surveyReadyAt = coalesce(b.surveyReadyAt, datetime()),
            b.surveyReadyReason = CASE WHEN b.surveyReadyReason = 'ended' THEN 'ended' ELSE $reason END
        RETURN b`, { bookingId, tutorId, reason });
      return result.records.length > 0 && surveyWindow(result.records[0]!.get('b').properties).eligible;
    } finally { await session.close(); }
  }

  async clearDepartureReadiness(bookingId: string, tutorId: string) {
    const session = getDriver().session();
    try {
      await session.run(`MATCH (b:Booking {bookingId: $bookingId, tutorId: $tutorId})
        WHERE b.surveyReadyReason = 'left'
        REMOVE b.surveyReadyAt, b.surveyReadyReason`, { bookingId, tutorId });
    } finally { await session.close(); }
  }

  async submit(bookingId: string, studentId: string, input: unknown) {
    const values = validateLessonSurvey(input);
    await this.ensureSchema();
    const session = getDriver().session();
    try {
      const saved = await session.executeWrite(async tx => {
        // Serialize rating updates on the tutor and duplicate submissions on the booking.
        const result = await tx.run(`MATCH (b:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(:Student {id: $studentId})
          MATCH (t:User {id: b.tutorId})
          SET t.surveyWriteVersion = coalesce(t.surveyWriteVersion, 0) + 1,
              b.surveyWriteVersion = coalesce(b.surveyWriteVersion, 0) + 1
          RETURN b, t`, { bookingId, studentId });
        if (!result.records.length) throw new StudentLessonAccessError('Lesson not found or you do not have access to this lesson');
        const booking = result.records[0]!.get('b').properties;
        const existing = await tx.run('MATCH (s:LessonSurvey {bookingId: $bookingId}) RETURN s', { bookingId });
        if (existing.records.length) throw new LessonSurveyError('You have already submitted a survey for this lesson.', 409);
        if (!surveyWindow(booking).eligible) throw new LessonSurveyError('Surveys open when your tutor finishes the lesson or at its scheduled end, and close 48 hours after the scheduled end.', 403);
        const tutor = result.records[0]!.get('t').properties;
        const rawCount = Number(tutor.totalReviews) || 0;
        const count = Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0;
        const previousRating = Number(tutor.rating) || 0;
        const rating = ((previousRating >= 1 && previousRating <= 5 ? previousRating : 0) * count + values.rating) / (count + 1);
        const submittedAt = new Date().toISOString();
        await tx.run(`MATCH (b:Booking {bookingId: $bookingId}), (t:User {id: $tutorId})
          CREATE (s:LessonSurvey {bookingId: $bookingId, studentId: $studentId, tutorId: $tutorId,
            rating: $rating, positive: $positive, improvement: $improvement, comment: $comment, submittedAt: $submittedAt})
          CREATE (b)-[:HAS_LESSON_SURVEY]->(s)
          SET t.rating = $average, t.totalReviews = $count`, { bookingId, studentId, tutorId: booking.tutorId,
          ...values, submittedAt, average: rating, count: count + 1 });
        return { survey: response({ ...values, submittedAt }), tutorId: booking.tutorId };
      });
      await invalidateCache('tutor:search:*').catch(error => console.error('Survey rating cache refresh failed:', error));
      await invalidateCache(`tutor:profile:${saved.tutorId}`).catch(error => console.error('Survey profile cache refresh failed:', error));
      return saved.survey;
    } finally { await session.close(); }
  }
}
export const lessonSurveyService = new LessonSurveyService();
