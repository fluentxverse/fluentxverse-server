import { digest } from '../src/services/screening/policy';
import type { ScreeningEvidence } from '../src/services/screening/evidence';

export function screeningFixture(): ScreeningEvidence {
  const tutorId = 'screening-test-tutor';
  const completedAt = '2026-10-11T00:00:00Z';
  const questions = Array.from({ length: 10 }, (_, id) => ({ id, correctAnswer: 0 }));
  const answers = questions.map(question => ({ questionId: question.id, selectedAnswer: question.id === 9 ? 1 : 0 }));
  return {
    tutorId,
    written: { attemptId: 'written-attempt-1', tutorId, score: 90, completedAt, content: { questions }, result: { tutorId, examId: 'written-attempt-1', percentage: 90, answers } },
    speaking: { attemptId: 'speaking-attempt-1', tutorId, score: 85, completedAt, content: { tasks: [{ id: 1 }] },
      result: { tutorId, examId: 'speaking-attempt-1', overallScore: 85, taskScores: [{ taskId: 1, percentage: 85, transcription: 'Server transcribed fixture.' }] },
      audioEvidence: [{ tutorId, examId: 'speaking-attempt-1', taskId: 1, source: 'server-transcription', audioHash: 'a'.repeat(64), transcriptHash: digest('Server transcribed fixture.') }] },
    profile: { approved: true, reviewerId: 'authorized-admin', reviewedAt: completedAt, record: { approved: true } },
    interview: { passed: true, reviewerId: 'authorized-admin', completedAt, attemptId: 'interview-1', record: { result: 'pass' } },
  };
}
