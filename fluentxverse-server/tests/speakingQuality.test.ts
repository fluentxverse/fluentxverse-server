import { expect, test } from 'bun:test';
import { readAloudFixture, speakingFixture } from './application.fixtures';
import { normalizeNewSpeakingContent, readAloudInstruction, readAloudGradingInstructions, READ_ALOUD_RUBRIC } from '../src/services/exam.services/speakingQuality';
import { validateSpeakingContent } from '../src/services/exam.services/applicationPolicy';
import { getSpeakingExamForClient, parseTaskGrade, summarizeSpeaking } from '../src/services/exam.services/speaking.service';
import { screeningFixture } from './screening.fixture';
import { assertScreeningEvidence } from '../src/services/screening/evidence';

const fixture = () => {
  const { title, description, tasks } = readAloudFixture();
  return { title, description, tasks };
};

test('new oral assessments have exactly ten distinct, ordered read-aloud sentences', () => {
  const exam = fixture(), original = structuredClone(exam);
  const content = normalizeNewSpeakingContent(exam);
  expect(content.format).toBe('read-aloud.v1');
  expect(content.tasks.every(t => t.type === 'read-aloud' && t.timeLimit === 30)).toBe(true);
  expect(validateSpeakingContent(content).tasks).toHaveLength(10);
  expect(exam).toEqual(original);
  expect(validateSpeakingContent(speakingFixture()).tasks).toHaveLength(10);
  for (const mutate of [
    (e: any) => e.tasks.pop(),
    (e: any) => e.tasks.push(e.tasks[0]),
    (e: any) => e.tasks[7] = speakingFixture().tasks[7],
    (e: any) => e.tasks[8].timeLimit = 120,
    (e: any) => e.tasks[1].sentence = e.tasks[0].sentence.toUpperCase(),
    (e: any) => e.tasks[0].sentence = 'Too short.',
    (e: any) => e.tasks[0].sentence = 'Read ' + 'a '.repeat(30),
    (e: any) => e.tasks[0].sentence = 'Please read the ____ words in this sentence aloud.',
    (e: any) => [e.tasks[0], e.tasks[9]] = [e.tasks[9], e.tasks[0]],
  ]) {
    const broken = fixture(); mutate(broken);
    expect(() => normalizeNewSpeakingContent(broken)).toThrow();
  }
});

test('read-aloud instructions and scoring require only reading, without leaking legacy grading hints', () => {
  const content = normalizeNewSpeakingContent(fixture());
  for (const task of content.tasks) expect(task.instruction).toBe(readAloudInstruction);
  const serialized = JSON.stringify(getSpeakingExamForClient({ ...readAloudFixture(), ...content }));
  for (const key of ['imageDescription', 'keyPoints', 'expectedTopics', 'expectedElements'])
    expect(serialized).not.toContain(key);
  expect(readAloudGradingInstructions).toContain('Do not demand original ideas');
  expect(readAloudGradingInstructions).toContain('NEVER score pronunciation');
  expect(readAloudGradingInstructions).toContain('Never announce a final pass, failure, rejection');
});

test('both above- and below-threshold results explicitly require human review, without changing gates', () => {
  const exam = readAloudFixture();
  for (const score of [3, 5]) {
    const scores = exam.tasks.map(t => parseTaskGrade(t, 'A relevant answer.', {
      scores: { vocabulary: score, grammar: score, coherence: score, taskCompletion: score },
      feedback: 'Content feedback.',
    }));
    const result = summarizeSpeaking(exam, 'synthetic-applicant', scores);
    expect(result.passed).toBe(score === 5);
    expect(result.decisionStatus).toBe('human_review_required');
    expect(result.audioReviewRequired).toBe(true);
    expect(result.format).toBe('read-aloud.v1');
    expect(result.rubricVersion).toBe(READ_ALOUD_RUBRIC);
    expect(result.overallFeedback).toContain('provisional AI content score');
    expect(result.overallFeedback).toContain('Human review');
    expect(result.sectionAverages.pronunciation).toBeNull();
  }
});

test('a read-aloud result cannot masquerade as the broader certification assessment', () => {
  const evidence = screeningFixture();
  evidence.speaking.content = readAloudFixture();
  // Even a relabelled legacy rubric cannot authorize the narrower assessment.
  expect(() => assertScreeningEvidence(evidence)).toThrow('Read-aloud-only screening');
  evidence.speaking.result.rubricVersion = READ_ALOUD_RUBRIC;
  expect(() => assertScreeningEvidence(evidence)).toThrow('approved content rubric');
});
