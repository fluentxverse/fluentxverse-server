import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildLesson2LearnParts } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-2-learn-parts';
import { buildLesson2 } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-2-listening';
import { lesson2Trivia, updateLesson2Trivia } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-2-trivia';

test('Lesson 2 includes discussion and pronunciation without replacing vocabulary', () => {
  const lesson = buildLesson2({ exerciseData: {} }, 'https://api.fluentxverse.com');
  const step = requireDefined(lesson.learnData.steps[0], "lesson.learnData.steps[0]");
  expect(step.vocabularyItems).toHaveLength(6);
  expect(step.discussionPart.images).toHaveLength(3);
  expect(requireDefined(step.discussionPart.images[0], "step.discussionPart.images[0]").image).toBe(requireDefined(step.vocabularyItems[0], "step.vocabularyItems[0]").image);
  expect(requireDefined(step.discussionPart.images[1], "step.discussionPart.images[1]").image).toBe(requireDefined(step.vocabularyItems[3], "step.vocabularyItems[3]").image);
  expect(requireDefined(step.discussionPart.images[2], "step.discussionPart.images[2]").image).toBe(requireDefined(step.vocabularyItems[4], "step.vocabularyItems[4]").image);
  expect(step.discussionPart.instructionTranslation).toBeTruthy();
  expect(step.pronunciationPart.instructionTranslation).toBeTruthy();
  expect(step.pronunciationPart.leftColumn.words.map(word => word.word)).toEqual(['light', 'long', 'glass']);
  expect(step.pronunciationPart.rightColumn.words.map(word => word.word)).toEqual(['right', 'wrong', 'grass']);
  expect(step.discussionPart.tutorSteps.length).toBeGreaterThan(2);
  expect(step.pronunciationPart.tutorSteps.length).toBeGreaterThan(2);
});

test('parts use supplied pictures and plain bilingual content', () => {
  const parts = buildLesson2LearnParts({ background: 'a', routine: 'b', plans: 'c' });
  expect(parts.discussionPart.images.map(image => image.image)).toEqual(['a', 'b', 'c']);
  expect(JSON.stringify(parts)).not.toMatch(/<[^>]+>|[\uac00-\ud7af]/u);
});

test('voice trivia update preserves the activity and student-reading guide', () => {
  const current = buildLesson2({ exerciseData: {} }, 'https://api.fluentxverse.com').applyData;
  const before = structuredClone(current);
  const next = updateLesson2Trivia(current);
  expect(next.triviaText).toBe(lesson2Trivia.text);
  expect(next.triviaTranslation).toBe(lesson2Trivia.translation);
  expect(next.triviaImage).toBe(current.situationImage);
  expect(next.triviaTutorSteps[1]).toEqual(current.triviaTutorSteps[1]);
  expect(next.triviaTutorSteps[2].questions[0].question).toBe(lesson2Trivia.question);
  expect(next.tutorSteps).toEqual(current.tutorSteps);
  expect(current).toEqual(before);
  expect(() => updateLesson2Trivia({ ...current, triviaTutorSteps: [] })).toThrow();
});

test('Challenge 1 offers retelling language without giving away listening answers', () => {
  const lesson = buildLesson2({ exerciseData: {} }, 'https://api.fluentxverse.com');
  expect(lesson.missionData.showGrammarTip).toBe(true);
  expect(lesson.missionData.grammarTipTitle).toBe('Useful language');
  expect(lesson.missionData.grammarTipItems).toEqual([
    'She grew up in ...',
    'She moved to Kyoto because ...',
    'She used to ..., but now she ...',
    "On Sunday, she'd like to ...",
  ]);
  expect(lesson.missionData2.showGrammarTip).toBe(false);
});
