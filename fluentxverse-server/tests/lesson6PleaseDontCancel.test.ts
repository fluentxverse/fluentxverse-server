import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildLesson6, lesson6ApplyScript, lesson6MissionScript, lesson6UsefulLanguage, lesson6ListeningChanges } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-6-listening';
import { buildLesson2 } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-2-listening';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';

const reference = buildLesson2({ exerciseData: {} }, 'https://api.fluentxverse.com');
const previous = { feedbackData: { ...reference.feedbackData, categories: [{ id: 'fixed', focusOn: 'Preserve the shared guide.' }] }, introductionData: { introImage: 'intro.webp' }, applyData: { situationImage: 'apply.webp', triviaImage: 'trivia.webp' }, missionData: { image: 'mission.webp' }, status: 'draft' };
const lesson = { course: 'conversational-skills', level: 3, chapter: 1, lessonNumber: 6, ...buildLesson6(previous, 'https://api.fluentxverse.com', reference) };

test('Lesson 6 is a complete listening continuation with two distinct messages', () => {
  expect(conversationalLessonErrors(lesson)).toEqual([]);
  expect(lesson.lessonName).toBe("Please Don't Cancel");
  expect(lesson.skill).toBe('listening');
  expect(lesson.applyData.activityType).toBe('listening');
  expect(lesson.missionData.missionType).toBe('listening');
  expect(lesson.applyData.dialogueLines).toEqual([]);
  expect(lesson6ApplyScript).toContain('<strong>Nao:</strong>');
  expect(lesson6ApplyScript).toContain('<strong>Claire:</strong>');
  expect(lesson6ApplyScript).toContain('not canceled');
  expect(lesson6MissionScript).toContain('still on Sunday');
  expect(lesson6MissionScript).toContain('from three to five');
  expect(lesson6MissionScript).toContain('this morning');
  expect(requireDefined(lesson.applyData.tutorSteps[1], "lesson.applyData.tutorSteps[1]").questions).toHaveLength(4);
  expect(lesson.storyData.previousSummary).toContain('Lesson 4');
  expect(lesson.storyData.nextEpisodeHook).toContain('Lesson 7');
  expect(requireDefined(requireDefined(requireDefined(lesson.missionData.tutorSteps[3], "lesson.missionData.tutorSteps[3]").scripts, "lesson.missionData.tutorSteps[3].scripts")[0], "lesson.missionData.tutorSteps[3].scripts[0]").text).toContain("Didn't you listen to my message?");
});

test('the five approved useful-language phrases are exact and support both exercises', () => {
  expect(lesson.missionData.grammarTipTitle).toBe('Useful language');
  expect(lesson.missionData.grammarTipItems).toEqual(lesson6UsefulLanguage);
  expect(lesson6UsefulLanguage).toHaveLength(5);
  expect(requireDefined(lesson.learnData.steps[0], "lesson.learnData.steps[0]").vocabularyItems).toHaveLength(6);
  expect(lesson.exerciseData.chooseItems).toHaveLength(6);
  expect(lesson.exerciseData.answers.map(answer => answer.text)).toEqual(['of', 'instead', 'is', 'confirm', 'on', 'still']);
  expect(lesson.exerciseData.multipleChoiceItems).toHaveLength(4);
  expect(requireDefined(requireDefined(lesson.exerciseData.stepBTutorSteps[1], "lesson.exerciseData.stepBTutorSteps[1]").answerKey, "lesson.exerciseData.stepBTutorSteps[1].answerKey").map(answer => answer.text.split(' - ')[0])).toEqual(['1. B', '2. B', '3. A', '4. B']);
  expect(requireDefined(lesson.exerciseData.stepBTutorSteps[0], "lesson.exerciseData.stepBTutorSteps[0]").scripts).toHaveLength(4);
  expect(requireDefined(requireDefined(lesson.exerciseData.tutorSteps[0], "lesson.exerciseData.tutorSteps[0]").tips[0], "lesson.exerciseData.tutorSteps[0].tips[0]").text).toContain('actual incorrect response');
});

test('guide shape matches the early lessons and listening evidence stays tutor-only', () => {
  const learn = requireDefined(lesson.learnData.steps[0], "lesson.learnData.steps[0]");
  expect(lesson.introductionData.lessonGoalSteps).toHaveLength(4);
  expect(learn.tutorSteps).toHaveLength(5);
  expect(learn.discussionPart.tutorSteps).toHaveLength(5);
  expect(learn.pronunciationPart.tutorSteps).toHaveLength(5);
  expect(lesson.stepBData.grammarTip.tutorSteps).toHaveLength(2);
  expect(lesson.applyData.tutorSteps).toHaveLength(2);
  expect(lesson.applyData.triviaTutorSteps).toHaveLength(4);
  expect(lesson.missionData.tutorSteps).toHaveLength(4);
  expect(requireDefined(lesson.missionData.tutorSteps[1], "lesson.missionData.tutorSteps[1]").listeningScript).toBe(lesson6MissionScript);
  const roleplay = requireDefined(lesson.missionData.tutorSteps[2], "lesson.missionData.tutorSteps[2]");
  expect(roleplay.instruction).toContain('tutor speaks first');
  expect(requireDefined(requireDefined(roleplay.scripts, "roleplay.scripts")[0], "roleplay.scripts[0]").text).toContain("I'll be Leo. Please be Emma.");
  expect(requireDefined(roleplay.scripts, "roleplay.scripts").slice(1).every(script => /^\d+\./.test(script.text))).toBe(true);
  expect(requireDefined(requireDefined(roleplay.tips, "roleplay.tips")[0], "roleplay.tips[0]").text).toContain('intentional');
  expect(lesson.missionData.questions).toEqual([]);
  expect(lesson.applyData.readingText).toBe('');
  expect(lesson.feedbackData.tutorSteps).toEqual(reference.feedbackData.tutorSteps);
  expect(lesson.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(lesson.feedbackData.goal).toBe(lesson.goalTextEn);
  expect(lesson.feedbackData.rubricTitle).toBe('LESSON OBJECTIVE ACHIEVEMENT');
});

test('listening stays short, chunked and focused for Level 3', () => {
  const words = (text: string) => text.replace(/<[^>]*>/g, ' ').split(/\s+/).filter(Boolean);
  expect(words(lesson6ApplyScript).length).toBeLessThanOrEqual(85);
  expect(words(lesson6MissionScript).length).toBeLessThanOrEqual(65);
  expect(lesson6ApplyScript).toContain('<br>');
  expect(lesson6MissionScript).toContain('<br>');
  expect(requireDefined(requireDefined(lesson.applyData.tutorSteps[0], "lesson.applyData.tutorSteps[0]").tips[0], "lesson.applyData.tutorSteps[0].tips[0]").text).toContain('90-100 words per minute');
  expect(requireDefined(requireDefined(lesson.applyData.tutorSteps[1], "lesson.applyData.tutorSteps[1]").tips[0], "lesson.applyData.tutorSteps[1].tips[0]").text).toContain('Accept short answers');
  expect(requireDefined(requireDefined(requireDefined(lesson.missionData.tutorSteps[1], "lesson.missionData.tutorSteps[1]").tips, "lesson.missionData.tutorSteps[1].tips")[0], "lesson.missionData.tutorSteps[1].tips[0]").text).toContain('Allow notes');
  expect(requireDefined(requireDefined(requireDefined(lesson.missionData.tutorSteps[2], "lesson.missionData.tutorSteps[2]").tips, "lesson.missionData.tutorSteps[2].tips")[1], "lesson.missionData.tutorSteps[2].tips[1]").text).toContain('not additional scored items');
});

test('live simplification preserves unrelated authored content and does not mutate its input', () => {
  const current = { ...lesson, applyData: { ...lesson.applyData, triviaText: 'A newer editor trivia.', situationImage: 'new-image.webp', customField: 'keep' }, missionData: { ...lesson.missionData, grammarTipItems: ['An editor phrase.'], image: 'new-mission.webp' } };
  const original = structuredClone(current);
  const changes = lesson6ListeningChanges(current);
  expect(Object.keys(changes).sort()).toEqual(['applyData', 'missionData']);
  expect(changes.applyData.triviaText).toBe(current.applyData.triviaText);
  expect(changes.applyData.situationImage).toBe(current.applyData.situationImage);
  expect(changes.applyData.customField).toBe('keep');
  expect(changes.missionData.grammarTipItems).toEqual(current.missionData.grammarTipItems);
  expect(changes.missionData.image).toBe(current.missionData.image);
  expect(current).toEqual(original);
});

test('does not replace images, reveal the cause early, or depend on a generated checkpoint story', () => {
  expect(lesson.introductionData.introImage).toBe('intro.webp');
  expect(lesson.applyData.situationImage).toBe('apply.webp');
  expect(lesson.applyData.triviaImage).toBe('trivia.webp');
  expect(lesson.missionData.image).toBe('mission.webp');
  expect(lesson.storyData.previousSummary).toContain('without requiring a fixed generated storyline');
  expect(lesson6ApplyScript + lesson6MissionScript).not.toMatch(/scheduled|on the train/);
  expect(JSON.stringify(lesson)).not.toMatch(/90-second|45-second|monologue|[\uac00-\ud7af]/u);
  expect(lesson.missionData2.topics).toHaveLength(3);
});
