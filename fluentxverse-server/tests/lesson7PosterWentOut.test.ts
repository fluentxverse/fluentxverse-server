import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildLesson7, lesson7Thread, lesson7Notices, lesson7UsefulLanguage } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-7-reading';
import { buildLesson6 } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-6-listening';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';

const reference = buildLesson6({ exerciseData: {} }, 'https://api.fluentxverse.com');
const previous = { feedbackData: { ...reference.feedbackData, categories: [{ id: 'static', focusOn: 'Keep the fixed guide.' }] }, introductionData: { introImage: 'intro.webp' }, applyData: { situationImage: 'apply.webp', triviaImage: 'trivia.webp' }, missionData: { image: 'mission.webp' } };
const lesson = { course: 'conversational-skills', level: 3, chapter: 1, lessonNumber: 7, ...buildLesson7(previous, 'https://api.fluentxverse.com', reference) };

test('Lesson 7 is a complete reading lesson with a timeline consistent with Lesson 6', () => {
  expect(conversationalLessonErrors(lesson)).toEqual([]);
  expect(lesson.skill).toBe('reading');
  expect(lesson.applyData.activityType).toBe('reading');
  expect(lesson.missionData.missionType).toBe('reading');
  expect(lesson.applyData.dialogueLines).toEqual([]);
  expect(lesson7Thread).toContain('9:50 | Emma');
  expect(lesson7Thread).toContain('10:10 | Claire');
  expect(lesson7Thread).toContain('10:13 | Emma');
  expect(lesson7Thread).toContain('I heard the new messages');
  expect(lesson7Thread).toContain('10:15 | Automatic post');
  expect(lesson7Thread).toContain('10:25 | Emma');
  expect(lesson7Thread).toContain('forgot to stop it');
  expect(lesson7Thread).toContain('while I was speaking to Leo');
  expect(lesson7Thread).not.toMatch(/on the train|had not seen|did not receive/);
  expect(lesson.storyData.previousSummary).toContain('Lesson 6');
  expect(lesson.storyData.nextEpisodeHook).toContain('in a dialogue');
});

test('the challenge has fresh written details rather than a memory test of Lesson 6', () => {
  const notice = requireDefined(lesson7Notices[1], "lesson7Notices[1]").content;
  expect(notice).toContain('updated Saturday, 11:00');
  expect(notice).toContain('Sunday, 3-5 p.m.');
  expect(notice).toContain('side entrance beside the bicycle parking area');
  expect(notice).toContain('No booking needed to see the pottery');
  expect(notice).toContain('Sunday, 4 p.m.');
  expect(notice).toContain('800 yen per person');
  expect(notice).toContain('Saturday at 6 p.m.');
  expect(lesson.missionData.readingPassage.blocks).toEqual(lesson7Notices);
  expect(lesson.missionData.instruction).toContain('Keep the notices visible');
  expect(lesson.missionData.grammarTipItems).toEqual(lesson7UsefulLanguage);
  expect(requireDefined(requireDefined(lesson.missionData.tutorSteps[2], "lesson.missionData.tutorSteps[2]").scripts[0], "lesson.missionData.tutorSteps[2].scripts[0]").text).toContain("I'll be a visitor. Please be Emma.");
  expect(requireDefined(lesson.missionData.tutorSteps[2], "lesson.missionData.tutorSteps[2]").scripts.slice(1).every(script => /^\d+\./.test(script.text))).toBe(true);
  expect(requireDefined(requireDefined(requireDefined(lesson.missionData.tutorSteps[2], "lesson.missionData.tutorSteps[2]").tips, "lesson.missionData.tutorSteps[2].tips")[1], "lesson.missionData.tutorSteps[2].tips[1]").text).toContain('800 yen');
  expect(requireDefined(requireDefined(lesson.missionData.tutorSteps[3], "lesson.missionData.tutorSteps[3]").scripts[0], "lesson.missionData.tutorSteps[3].scripts[0]").text).toContain('Can we talk?');
});

test('guide structure, answer keys, Japanese support, and fixed feedback follow the standard', () => {
  const learn = requireDefined(lesson.learnData.steps[0], "lesson.learnData.steps[0]");
  expect(lesson.introductionData.lessonGoalSteps).toHaveLength(4);
  expect(learn.tutorSteps).toHaveLength(5);
  expect(learn.discussionPart.tutorSteps).toHaveLength(5);
  expect(learn.pronunciationPart.tutorSteps).toHaveLength(5);
  expect(learn.pronunciationPart.leftColumn.words).toHaveLength(3);
  expect(learn.pronunciationPart.rightColumn.words).toHaveLength(3);
  expect(lesson.stepBData.grammarTip.tutorSteps).toHaveLength(2);
  expect(lesson.applyData.tutorSteps).toHaveLength(2);
  expect(requireDefined(lesson.applyData.tutorSteps[1], "lesson.applyData.tutorSteps[1]").questions).toHaveLength(5);
  expect(lesson.missionData.tutorSteps).toHaveLength(4);
  expect(lesson.exerciseData.chooseItems).toHaveLength(6);
  expect(lesson.exerciseData.answers.map(answer => answer.text)).toEqual(['before', 'after', 'latest', 'belief', 'automatically', 'corrected']);
  expect(lesson.exerciseData.multipleChoiceItems).toHaveLength(4);
  expect(requireDefined(requireDefined(lesson.exerciseData.stepBTutorSteps[1], "lesson.exerciseData.stepBTutorSteps[1]").answerKey, "lesson.exerciseData.stepBTutorSteps[1].answerKey").map(answer => answer.text.split(' - ')[0])).toEqual(['1. B', '2. A', '3. B', '4. A']);
  expect(lesson.feedbackData.tutorSteps).toEqual(reference.feedbackData.tutorSteps);
  expect(lesson.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(lesson.feedbackData.goal).toBe(lesson.goalTextEn);
  expect(lesson.feedbackData.goalJp).toBe(lesson.goalTextJp);
  expect(lesson.missionData2.topics).toHaveLength(3);
  expect(requireDefined(lesson.introductionData.introTexts[1], "lesson.introductionData.introTexts[1]").text).toMatch(/[ぁ-んァ-ン]/u);
  expect(learn.vocabularyItems.every(item => /[ぁ-んァ-ン]/u.test(requireDefined(item.translation, 'vocabulary translation')))).toBe(true);
});

test('reading branches do not leak inherited listening sources or replace images', () => {
  expect(JSON.stringify(lesson.applyData)).not.toContain('listeningScript');
  expect(JSON.stringify(lesson.missionData)).not.toContain('listeningScript');
  expect(lesson.introductionData.introImage).toBe('intro.webp');
  expect(lesson.applyData.situationImage).toBe('apply.webp');
  expect(lesson.applyData.triviaImage).toBe('trivia.webp');
  expect(lesson.missionData.image).toBe('mission.webp');
  expect(JSON.stringify(lesson)).not.toMatch(/90-second|45-second|monologue|[\uac00-\ud7af]/u);
});
