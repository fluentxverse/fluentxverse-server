import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildLesson3LearnParts } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-3-learn-parts';
import { buildLesson3 } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-3-reading';
import { buildStepBTutorGuide } from '../content/conversational-skills/ja/level-3-chapter-1/standardize-tutor-guides';
import { lesson3Trivia, updateLesson3Trivia } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-3-trivia';

test('Lesson 3 includes rental discussion and basic pronunciation, preserving vocabulary', () => {
  const lesson = buildLesson3({ exerciseData: {} }, 'https://api.fluentxverse.com');
  const step = requireDefined(lesson.learnData.steps[0], "lesson.learnData.steps[0]");
  expect(step.vocabularyItems).toHaveLength(6);
  expect(step.discussionPart.images.map(item => item.image)).toEqual([requireDefined(step.vocabularyItems[0], "step.vocabularyItems[0]").image, requireDefined(step.vocabularyItems[1], "step.vocabularyItems[1]").image, requireDefined(step.vocabularyItems[4], "step.vocabularyItems[4]").image]);
  expect(step.discussionPart.instructionTranslation).toBeTruthy();
  expect(step.pronunciationPart.instructionTranslation).toBeTruthy();
  expect(step.pronunciationPart.leftColumn.soundSymbol).toBe('/b/');
  expect(step.pronunciationPart.rightColumn.soundSymbol).toBe('/p/');
  expect(step.pronunciationPart.leftColumn.words.map(word => word.word)).toEqual(['big', 'back', 'buy']);
  expect(step.pronunciationPart.rightColumn.words.map(word => word.word)).toEqual(['pig', 'pack', 'pie']);
  expect(step.discussionPart.tutorSteps.length).toBeGreaterThan(2);
  expect(step.pronunciationPart.tutorSteps.length).toBeGreaterThan(2);
});

test('parts reuse pictures and contain plain bilingual text', () => {
  const parts = buildLesson3LearnParts({ cityBike: 'a', electricBike: 'b', extras: 'c' });
  expect(parts.discussionPart.images.map(image => image.image)).toEqual(['a', 'b', 'c']);
  expect(JSON.stringify(parts)).not.toMatch(/<[^>]+>|[\uac00-\ud7af]/u);
});

test('Reading Tip uses the same Step B guide structure as Grammar Tip', () => {
  const lesson = buildLesson3({ exerciseData: {} }, 'https://api.fluentxverse.com');
  const reading = lesson.stepBData.grammarTip;
  const grammarGuide = buildStepBTutorGuide('Where did you use to live?');
  expect(reading.stepName).toBe('STEP B: READING TIP');
  expect(reading.explanations).toHaveLength(2);
  expect(reading.tutorSteps).toHaveLength(2);
  expect(reading.tutorSteps[0]).toEqual(grammarGuide[0]);
  expect(reading.tutorSteps.map(step => step.instruction)).toEqual(grammarGuide.map(step => step.instruction));
  expect(requireDefined(reading.tutorSteps[1], "reading.tutorSteps[1]").script).toContain('basket');
});

test('trivia changes only bilingual text and its question, preserving the guide format', () => {
  const current = buildLesson3({ exerciseData: {} }, 'https://api.fluentxverse.com').applyData;
  const before = structuredClone(current);
  const next = updateLesson3Trivia(current);
  expect(next.triviaText).toBe(lesson3Trivia.text);
  expect(next.triviaTranslation).toBe(lesson3Trivia.translation);
  expect(next.triviaTutorSteps[2].questions[0]).toEqual({ question: lesson3Trivia.question, answer: "(student's own answer)" });
  expect(next.triviaTutorSteps[1]).toEqual(current.triviaTutorSteps[1]);
  expect(next.triviaImage).toBe(current.triviaImage);
  expect(next.tutorSteps).toEqual(current.tutorSteps);
  expect(next.readingText).toBe(current.readingText);
  expect(current).toEqual(before);
  expect(() => updateLesson3Trivia({ ...current, triviaTutorSteps: [] })).toThrow();
});

test('reading challenge has clear roles and numbered tutor-first dialogue like Lessons 1 and 2', () => {
  const mission = buildLesson3({ exerciseData: {} }, 'https://api.fluentxverse.com').missionData;
  expect(mission.missionType).toBe('reading');
  expect(mission.situation).toContain('You are Emma.');
  expect(mission.readingPassage.title).toBe('Riverside Cycle Kyoto');
  expect(requireDefined(mission.readingPassage.blocks[0], "mission.readingPassage.blocks[0]").content).toContain('2 hours: ¥900');
  expect(mission.tutorSteps).toHaveLength(4);
  const roleplay = requireDefined(mission.tutorSteps[2], "mission.tutorSteps[2]");
  expect(roleplay.instruction).toContain('The tutor speaks first');
  expect(requireDefined(roleplay.scripts[0], "roleplay.scripts[0]").text).toContain("I'll be Claire. Please be Emma.");
  expect(roleplay.scripts.slice(1).map(script => script.text.match(/^\d+\./)?.[0])).toEqual(['1.', '2.', '3.', '4.', '5.', '6.']);
  expect('prompts' in roleplay).toBe(false);
  expect(requireDefined(roleplay.scripts[1], "roleplay.scripts[1]").text).toContain('Hi Emma');
  expect(requireDefined(mission.tutorSteps[1], "mission.tutorSteps[1]").instruction).toContain('before the roleplay');
});
