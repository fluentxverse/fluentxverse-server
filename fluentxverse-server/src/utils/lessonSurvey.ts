export const LESSON_SURVEY_TOPICS = [
  { id: 'connection', label: 'Audio and connection quality', positive: true },
  { id: 'feedback', label: 'End-of-lesson feedback', positive: true },
  { id: 'corrections', label: 'Corrections and explanations', positive: true },
  { id: 'pace', label: "Tutor's speaking pace", positive: true },
  { id: 'difficulty', label: 'Lesson difficulty for my English level', positive: true },
  { id: 'environment', label: 'Quiet learning environment', positive: false },
  { id: 'start_time', label: 'Starting the lesson on time', positive: false },
  { id: 'end_time', label: 'Finishing the lesson on time', positive: false },
  { id: 'engagement', label: 'Tutor focus and engagement', positive: false },
  { id: 'request', label: 'Following my lesson request', positive: false },
  { id: 'other', label: 'Other', positive: true },
] as const;

export class LessonSurveyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function surveyWindow(booking: Record<string, any>, now = Date.now()) {
  const value = booking.slotDateTime;
  const startsAt = value?.toStandardDate ? value.toStandardDate().getTime() : Date.parse(value);
  const endsAt = startsAt + (Number(booking.durationMinutes) || 25) * 60_000;
  const closesAt = endsAt + 48 * 3600_000;
  const readyValue = booking.surveyReadyAt;
  const readyAt = readyValue?.toStandardDate ? readyValue.toStandardDate().getTime() : Date.parse(readyValue);
  const tutorFinished = Number.isFinite(readyAt) && readyAt >= startsAt && readyAt <= now;
  const reason = !Number.isFinite(endsAt) || !['confirmed', 'completed'].includes(booking.status)
    ? 'unavailable' : booking.attendanceStudent === 'absent' ? 'absent'
    : now < endsAt && !tutorFinished ? 'not_ended' : now >= closesAt ? 'closed' : null;
  return { eligible: !reason, reason, endsAt: Number.isFinite(endsAt) ? new Date(endsAt).toISOString() : null,
    readyAt: tutorFinished ? new Date(readyAt).toISOString() : null,
    closesAt: Number.isFinite(closesAt) ? new Date(closesAt).toISOString() : null };
}

export function validateLessonSurvey(input: unknown) {
  const value = input as Record<string, any> | null;
  if (!value || !Number.isInteger(value.rating) || value.rating < 1 || value.rating > 5)
    throw new LessonSurveyError('Choose an overall lesson rating from 1 to 5.');
  const choices = (field: 'positive' | 'improvement') => {
    const items = value[field] ?? [];
    if (!Array.isArray(items) || items.length > LESSON_SURVEY_TOPICS.length || items.some(id =>
      typeof id !== 'string' || !LESSON_SURVEY_TOPICS.some(topic => topic.id === id && (field !== 'positive' || topic.positive))))
      throw new LessonSurveyError('Choose valid lesson feedback topics.');
    return [...new Set<string>(items)];
  };
  const positive = choices('positive'), improvement = choices('improvement');
  if (positive.some(id => id !== 'other' && improvement.includes(id)))
    throw new LessonSurveyError('A topic cannot be selected in both feedback groups.');
  if (value.comment != null && (typeof value.comment !== 'string' || value.comment.length > 500))
    throw new LessonSurveyError('Your comment must be 500 characters or fewer.');
  return { rating: value.rating as number, positive, improvement, comment: (value.comment || '').trim() as string };
}

export function summarizeLessonSurveys(surveys: Record<string, any>[]) {
  const total = surveys.length;
  const distribution = [1, 2, 3, 4, 5].map(rating => ({ rating, count: surveys.filter(s => Number(s.rating) === rating).length }));
  const topics = LESSON_SURVEY_TOPICS.map(topic => {
    const positive = surveys.filter(s => Array.isArray(s.positive) && s.positive.includes(topic.id)).length;
    const improvement = surveys.filter(s => Array.isArray(s.improvement) && s.improvement.includes(topic.id)).length;
    return { ...topic, positiveEnabled: topic.positive, positive, improvement,
      positiveRate: total ? Math.round(positive / total * 1000) / 10 : null,
      improvementRate: total ? Math.round(improvement / total * 1000) / 10 : null };
  });
  return { total, average: total ? Math.round(surveys.reduce((sum, s) => sum + Number(s.rating), 0) / total * 10) / 10 : null,
    distribution, topics };
}
