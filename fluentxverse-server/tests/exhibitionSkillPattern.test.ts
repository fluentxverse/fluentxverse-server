import { expect, test } from 'bun:test';
import { buildArcLesson, exhibitionArcIds, exhibitionArcSkills } from '../content/conversational-skills/ja/level-3-chapter-1/lessons-6-9';
import { buildLesson4 } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-4-speaking';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { checkpointPrompt, sourceNumbers, summarizeCheckpointEvidence } from '../src/services/checkpointLesson.service';

const reference = buildLesson4({}, 'https://api.fluentxverse.com');
const previous = { feedbackData: { ...reference.feedbackData, categories: [{ id: 'fixed', focusOn: 'Keep this shared rubric.' }] }, backgroundImage: 'background.webp', introductionData: { introImage: 'intro.webp' }, applyData: { situationImage: 'apply.webp', triviaEnabled: true, triviaText: 'Existing trivia.', triviaTranslation: '既存の豆知識。', triviaImage: 'trivia.webp', triviaTutorSteps: [{ questions: [{ question: 'Existing question?', answer: 'Existing answer.' }] }] }, missionData: { image: 'mission.webp' } };
const lessons = ([6, 7, 8, 9] as const).map(number => ({ course: 'conversational-skills', level: 3, chapter: 1, lessonNumber: number, status: 'draft', ...buildArcLesson(number, { ...previous, id: exhibitionArcIds[number] }, 'https://api.fluentxverse.com', reference) }));

test('corrected pattern changes active skills and activities without changing IDs', () => {
  expect(lessons.map(lesson => lesson.skill)).toEqual(['speaking', 'speaking', 'reading', 'speaking']);
  for (const lesson of lessons) {
    const number = lesson.lessonNumber as keyof typeof exhibitionArcSkills;
    expect(lesson.skill).toBe(exhibitionArcSkills[number]);
    expect(lesson.id).toBe(exhibitionArcIds[number]);
    expect(lesson.applyData.activityType).toBe(lesson.skill);
    expect(lesson.missionData.missionType).toBe(lesson.skill);
    expect(conversationalLessonErrors(lesson)).toEqual([]);
    expect(JSON.stringify(lesson.applyData)).not.toContain('listeningScript');
    expect(JSON.stringify(lesson.missionData)).not.toContain('listeningScript');
    expect(lesson.missionData2.missionType).toBe('discussion');
  }
});

test('speaking Apply sections are short two-person dialogues and roleplays start with the tutor', () => {
  for (const lesson of lessons.filter(lesson => lesson.skill === 'speaking')) {
    const lines = lesson.applyData.dialogueLines;
    expect(lines.length).toBeGreaterThanOrEqual(10);
    expect(new Set(lines.map((line: any) => line.speaker)).size).toBe(2);
    expect(lines.every((line: any, index: number) => index === 0 || line.speaker !== lines[index - 1].speaker)).toBe(true);
    expect(lines.every((line: any) => line.text.split(/\s+/).length <= 25)).toBe(true);
    expect(lines.map((line: any) => line.text).join(' ').split(/\s+/).length).toBeLessThan(160);
    expect(lesson.missionData.tutorSteps).toHaveLength(3);
    const roleplay = lesson.missionData.tutorSteps[1];
    expect(roleplay.instruction).toContain('tutor speaks first');
    expect(roleplay.scripts[0].text).toContain("I'll be");
    expect(roleplay.scripts.slice(1).every((script: any) => /^\d+\./.test(script.text))).toBe(true);
    expect(lesson.applyData.readingText).toBe('');
    expect(lesson.missionData.readingPassage).toBeUndefined();
    expect(JSON.stringify(lesson)).not.toMatch(/90-second|45-second|monologue|without tutor interruptions|on the train/);
  }
});

test('Lesson 8 reads real notices and introduces fresh information for its reading challenge', () => {
  const lesson = lessons[2];
  expect(lesson.lessonName).toBe('The Correct Notice');
  expect(lesson.applyData.dialogueLines).toEqual([]);
  expect(lesson.applyData.readingText).toContain('OLD POSTER');
  expect(lesson.applyData.readingText).toContain('CORRECTED NOTICE');
  expect(lesson.missionData.tutorSteps).toHaveLength(4);
  const passage = lesson.missionData.readingPassage.blocks.map((block: any) => block.content).join(' ');
  for (const text of ['Sunday, 3-5 p.m.', 'side entrance', '800 yen', 'Saturday at 6 p.m.']) expect(passage).toContain(text);
  expect(lesson.missionData.instruction).toContain('Keep the notices visible');
});

test('guide standard, assessment item counts, Japanese support and existing images remain intact', () => {
  for (const lesson of lessons) {
    const learn = lesson.learnData.steps[0];
    expect(lesson.introductionData.lessonGoalSteps).toHaveLength(4);
    expect(learn.tutorSteps).toHaveLength(5);
    expect(learn.discussionPart.tutorSteps).toHaveLength(5);
    expect(learn.pronunciationPart.tutorSteps).toHaveLength(5);
    expect(lesson.stepBData.grammarTip.tutorSteps).toHaveLength(2);
    expect(lesson.applyData.tutorSteps).toHaveLength(2);
    expect(lesson.applyData.triviaTutorSteps).toHaveLength(4);
    expect(lesson.feedbackData.tutorSteps).toEqual(reference.feedbackData.tutorSteps);
    expect(lesson.feedbackData.categories).toEqual(previous.feedbackData.categories);
    expect(lesson.exerciseData.chooseItems).toHaveLength(6);
    expect(lesson.exerciseData.answers).toHaveLength(6);
    expect(lesson.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(lesson.exerciseData.stepBTutorSteps[1].answerKey).toHaveLength(4);
    expect(lesson.backgroundImage).toBe(previous.backgroundImage);
    expect(lesson.introductionData.introImage).toBe(previous.introductionData.introImage);
    expect(lesson.applyData.situationImage).toBe(previous.applyData.situationImage);
    expect(lesson.applyData.triviaImage).toBe(previous.applyData.triviaImage);
    expect(lesson.applyData.triviaText).toBe(previous.applyData.triviaText);
    expect(lesson.missionData.image).toBe(previous.missionData.image);
    expect(lesson.goalTextJp).toMatch(/[ぁ-んァ-ン]/u);
  }
  expect(lessons[0].missionData.grammarTipItems).toEqual(["There's been a change of plans.", "We're meeting at ... instead.", 'The new starting time is ...', 'Just to confirm, ... Is that right?', 'Could you pass the message on to ...?']);
});

test('Lesson 10 checkpoint retains four-lesson coverage with the corrected skills', () => {
  expect(sourceNumbers(10)).toEqual([6, 7, 8, 9]);
  const prompt = checkpointPrompt(lessons as any, summarizeCheckpointEvidence([], []));
  for (const lesson of lessons) expect(prompt).toContain(lesson.goalTextEn);
  expect(prompt).toContain('Do not identify or invent student weaknesses');
});
