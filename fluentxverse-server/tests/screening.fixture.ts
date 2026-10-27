import { digest } from '../src/services/screening/policy';
import type { ScreeningEvidence } from '../src/services/screening/evidence';
import { speakingFixture, writtenFixture } from './application.fixtures';

export function screeningFixture(): ScreeningEvidence {
  const tutorId = 'screening-test-tutor';
  const completedAt = '2026-10-11T00:00:00Z';
  const written = writtenFixture(), speaking = speakingFixture();
  const answers = written.questions.map((question, index) => ({ questionId: question.id, selectedAnswer: index < 27 ? question.correctAnswer : (question.correctAnswer + 1) % 4 }));
  return {
    tutorId,
    written: { attemptId: 'written-attempt-1', tutorId, score: 90, completedAt, content: written, result: { tutorId, examId: 'written-attempt-1', percentage: 90, passed: true, answers } },
    speaking: { attemptId: 'speaking-attempt-1', tutorId, score: 85, completedAt, content: speaking,
      result: { tutorId, examId: 'speaking-attempt-1', overallScore: 85, passed: true, rubricVersion: 'transcript-content.v2', assessmentMode: 'transcript-content', audioReviewRequired: true,
        taskScores: speaking.tasks.map(task => ({ taskId: task.id, taskType: task.type, percentage: 85, averageScore: 4.25,
          scores: { vocabulary: 5, grammar: 4, coherence: 4, taskCompletion: 4, pronunciation: null, fluency: null }, transcription: 'Server transcribed fixture.' })) },
      audioEvidence: speaking.tasks.map(task => ({ tutorId, examId: 'speaking-attempt-1', taskId: task.id, source: 'server-transcription', audioHash: 'a'.repeat(64), transcriptHash: digest('Server transcribed fixture.') })) },
    profile: { approved: true, reviewerId: 'authorized-admin', reviewedAt: completedAt, record: { approved: true } },
    interview: { passed: true, reviewerId: 'authorized-admin', completedAt, attemptId: 'interview-1', record: { result: 'pass' } },
  };
}
