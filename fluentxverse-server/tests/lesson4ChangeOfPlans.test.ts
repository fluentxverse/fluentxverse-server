import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildLesson4 } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-4-speaking';
import { buildLesson3 } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-3-reading';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';

const reference = buildLesson3({ exerciseData: {} }, 'https://api.fluentxverse.com');
const previous = { feedbackData: { ...reference.feedbackData, categories: [{ id: 'static', focusOn: 'Keep the fixed rubric.' }] }, applyData: { triviaEnabled: true, triviaText: 'Existing trivia.', triviaTranslation: '既存の豆知識。', triviaTutorSteps: [{ instruction: 'Ask the student to read the trivia.' }] } };
const lesson = { course: 'conversational-skills', level: 3, chapter: 1, lessonNumber: 4, ...buildLesson4(previous, 'https://api.fluentxverse.com', reference) };

test('Apply is an alternating two-person dialogue continuing Lesson 3, not a speech', () => {
  expect(conversationalLessonErrors(lesson)).toEqual([]);
  expect(lesson.lessonName).toBe('A Change of Plans');
  expect(lesson.skill).toBe('speaking');
  expect(lesson.applyData.activityType).toBe('speaking');
  expect(lesson.applyData.dialogueLines).toHaveLength(12);
  expect(lesson.applyData.dialogueLines.map(line => line.speaker)).toEqual(Array.from({ length: 12 }, (_, i) => i % 2 ? 'Emma' : 'Claire'));
  expect(lesson.applyData.dialogueLines.every(line => line.text.split(' ').length < 40)).toBe(true);
  expect(lesson.applyData.situationText).toContain('rented their bikes at ten');
  expect(lesson.applyData.situationText).toContain('by noon');
  expect(JSON.stringify(lesson.applyData.dialogueLines)).toContain('by noon');
  expect(requireDefined(lesson.applyData.tutorSteps[1], "lesson.applyData.tutorSteps[1]").questions).toHaveLength(3);
  expect(lesson.storyData.previousSummary).toContain('Lesson 3');
});

test('language and exercises prepare the same decision-making task', () => {
  expect(requireDefined(lesson.learnData.steps[0], "lesson.learnData.steps[0]").vocabularyItems).toHaveLength(6);
  expect(lesson.exerciseData.chooseItems).toHaveLength(6);
  expect(lesson.exerciseData.answers.map(answer => answer.text)).toEqual(['return', 'finish', 'know', 'takes', 'to meet', 'because']);
  expect(lesson.exerciseData.multipleChoiceItems).toHaveLength(4);
  expect(lesson.missionData.situation).toContain('10:30 a.m.');
  expect(lesson.missionData.situation).toContain('fifteen minutes away');
  expect(lesson.missionData.instruction).toContain('two possible plans');
  expect(lesson.missionData.grammarTipTitle).toBe('Useful language');
  expect(requireDefined(lesson.missionData.tutorSteps[1], "lesson.missionData.tutorSteps[1]").instruction).toContain('tutor speaks first');
  expect(requireDefined(requireDefined(lesson.missionData.tutorSteps[1], "lesson.missionData.tutorSteps[1]").scripts[0], "lesson.missionData.tutorSteps[1].scripts[0]").text).toContain("I'll be Claire. Please be Emma.");
  expect(requireDefined(lesson.missionData.tutorSteps[1], "lesson.missionData.tutorSteps[1]").scripts.slice(1).every(script => /^\d+\./.test(script.text))).toBe(true);
  expect(lesson.missionData2.topics).toHaveLength(3);
  expect(JSON.stringify(lesson)).not.toMatch(/90-second|45-second|one continuous message|without tutor interruptions/);
});

test('guides follow the standard and preserve fixed feedback and existing trivia', () => {
  const step = requireDefined(lesson.learnData.steps[0], "lesson.learnData.steps[0]");
  expect(lesson.introductionData.lessonGoalSteps).toHaveLength(4);
  expect(step.tutorSteps).toHaveLength(5);
  expect(step.discussionPart.tutorSteps).toHaveLength(5);
  expect(step.pronunciationPart.tutorSteps).toHaveLength(5);
  expect(lesson.stepBData.grammarTip.tutorSteps).toHaveLength(2);
  expect(lesson.feedbackData.tutorSteps).toEqual(reference.feedbackData.tutorSteps);
  expect(lesson.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(lesson.applyData.triviaText).toBe(previous.applyData.triviaText);
  expect(lesson.applyData.triviaTutorSteps).toEqual(previous.applyData.triviaTutorSteps);
  expect(lesson.feedbackData.goal).toBe(lesson.goalTextEn);
  expect(lesson.feedbackData.goalJp).toBe(lesson.goalTextJp);
  expect(JSON.stringify(lesson)).not.toMatch(/https?:\/\/[^" ]+\.(?:webp|png|jpe?g)|[\uac00-\ud7af]/u);
});
