import { describe, expect, test } from 'bun:test';
import { lesson1Trivia, updateLesson1Trivia } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-1-trivia';

describe('Lesson 1 liking-gap trivia', () => {
  const current = {
    situationText: 'Emma and Claire meet in Kyoto.',
    dialogueLines: [{ speaker: 'Claire', text: 'Welcome!' }],
    triviaEnabled: true,
    triviaText: 'Previous trivia',
    triviaTranslation: '前の内容',
    triviaImage: 'https://api.fluentxverse.com/existing.webp',
    triviaDuration: '1 minute',
    triviaTutorSteps: [
      { instruction: 'Ask the student to read the trivia.' },
      { instruction: 'Ask the question below.', questions: [{ question: 'Old question', answer: "(student's own answer)", custom: 'keep' }] },
      { instruction: 'Transition.', scripts: [{ text: 'Great!' }] },
    ],
  };

  test('changes only trivia text, translation and discussion question', () => {
    const snapshot = structuredClone(current);
    const next = updateLesson1Trivia(current);
    expect(next.triviaText).toBe(lesson1Trivia.text);
    expect(next.triviaTranslation).toBe(lesson1Trivia.translation);
    expect(next.triviaTutorSteps[1].questions[0]).toEqual({ question: lesson1Trivia.question, answer: "(student's own answer)", custom: 'keep' });
    const { triviaText, triviaTranslation, triviaTutorSteps, ...unchanged } = next;
    const { triviaText: oldText, triviaTranslation: oldTranslation, triviaTutorSteps: oldSteps, ...original } = current;
    expect(unchanged).toEqual(original);
    expect(triviaTutorSteps[0]).toEqual(oldSteps[0]);
    expect(triviaTutorSteps[2]).toEqual(oldSteps[2]);
    expect(current).toEqual(snapshot);
    expect(next.triviaText).not.toMatch(/<[^>]+>/);
    expect(next.triviaTranslation).not.toMatch(/<[^>]+>/);
  });

  test('refuses unexpected or ambiguous guide content', () => {
    expect(() => updateLesson1Trivia({ ...current, triviaEnabled: false })).toThrow();
    expect(() => updateLesson1Trivia({ ...current, triviaTutorSteps: [] })).toThrow();
    expect(() => updateLesson1Trivia({ ...current, triviaTutorSteps: [current.triviaTutorSteps[1], current.triviaTutorSteps[1]] })).toThrow();
  });
});
