import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildAfterTruthChapter, buildAfterTruthLesson, afterTruthEpisodes, afterTruthId } from '../content/conversational-skills/ja/level-4-chapter-1/build';
import { buildTwoCitiesChapter } from '../content/conversational-skills/ja/level-3-chapter-5/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildAfterTruthChapter();
test('Level 4 Chapter 1 maps the supplied eight episodes without using checkpoint slots for story lessons', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.lessonName)).toEqual(['The Morning After', 'An Uncomfortable Conversation', 'Different Opinions', 'A Chance to Explain', 'Trouble at Work', 'Finding Some Peace', 'The Decision', 'A Different Kind of Goodbye']);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const l of lessons) {
    expect(l.id).toBe(afterTruthId(l.lessonNumber));
    expect(l.chapter).toBe(1);
    expect(l.level).toBe(4);
    expect(l.chapterName).toBe('After the Truth');
    expect(l.status).toBe('draft');
    expect(conversationalLessonErrors(l)).toEqual([]);
  }
});
test('continuity retains the hidden dinner instead of reintroducing the removed incident', () => {
  expect(JSON.stringify(lessons)).not.toMatch(/\bkiss(?:ed|es|ing)?\b|キス|口づけ|invented adult character|You may play|No personal or romantic/i);
  expect(lessons[0].storyData.previousSummary).toContain('hidden Friday dinner');
  expect(lessons[1].storyData.currentEpisodeSummary).toContain('false work message');
  expect(lessons[3].missionData.situation).toContain('Ren had expressed feelings before Friday');
  expect(lessons[6].applyData.readingText).toContain('I hid Friday\'s dinner');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(afterTruthEpisodes[requireDefined(storyLessonNumbers[i - 1], "storyLessonNumbers[i - 1]")].closing);
});
test('direct roles reflect the actual scene and the standardized guides remain intact', () => {
  expect(lessons.map(l => l.missionData.situation.match(/^You are (\w+)/)?.[1])).toEqual(['Leo', 'Emma', 'Claire', 'Emma', 'Emma', 'Leo', 'Claire', 'Emma']);
  for (const l of lessons) {
    const learn = l.learnData.steps[0];
    expect(l.introductionData.lessonGoalSteps).toHaveLength(4);
    expect(learn.vocabularyItems).toHaveLength(6);
    expect(learn.tutorSteps).toHaveLength(5);
    expect(learn.discussionPart.tutorSteps).toHaveLength(5);
    expect(learn.pronunciationPart.tutorSteps).toHaveLength(5);
    expect(l.stepBData.grammarTip.explanations).toHaveLength(2);
    expect(l.stepBData.grammarTip.tutorSteps).toHaveLength(2);
    expect(l.applyData.tutorSteps).toHaveLength(2);
    expect(l.applyData.triviaTutorSteps).toHaveLength(4);
    expect(l.missionData.tutorSteps).toHaveLength(l.skill === 'speaking' ? 3 : 4);
    expect(l.missionData2.topics).toHaveLength(3);
    expect(l.feedbackData.tutorSteps).toHaveLength(6);
    expect(l.feedbackData.rubricLevels.map((r: any) => r.score)).toEqual([4, 3, 2, 1]);
    expect(l.feedbackData.categories.map((c: any) => c.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    for (const value of [l.goalTextJp, l.introductionData.introTexts[1].text, l.applyData.situationTranslation, l.applyData.triviaTranslation, l.missionData.situationTranslation, l.missionData.instructionTranslation, ...learn.vocabularyItems.map((v: any) => v.translation)]) expect(value).toMatch(/[ぁ-んァ-ン]/u);
    expect(JSON.stringify(l)).not.toMatch(/[\uac00-\ud7af]/u);
  }
});
test('speaking is short tutor-first dialogue and listening has two distinct private scripts', () => {
  for (const l of lessons.filter(l => l.skill === 'speaking')) {
    const lines = l.applyData.dialogueLines;
    expect(lines).toHaveLength(10);
    expect(lines.map((line: any) => line.text).join(' ').split(/\s+/).length).toBeLessThan(165);
    for (let i = 1; i < lines.length; i++) expect(lines[i].speaker).not.toBe(lines[i - 1].speaker);
    expect(l.missionData.tutorSteps[1].instruction).toContain('tutor speaks first');
    expect(l.missionData.tutorSteps[1].scripts[1].text).toStartWith('1.');
  }
  const l = lessons[1];
  expect(l.applyData.readingText).toBe('');
  expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.readingPassage).toBeUndefined();
  expect(l.missionData.listeningScript).toBeUndefined();
  const scripts = [l.applyData.tutorSteps[0].listeningScript, l.missionData.tutorSteps[1].listeningScript];
  for (const text of scripts) expect(text.replace(/<[^>]*>/g, '').split(/\s+/).length).toBeLessThan(80);
  expect(scripts[0]).not.toBe(scripts[1]);
});
test('exercise keys align with complete six-item and four-item branches', () => {
  for (const l of lessons) {
    expect(l.exerciseData.stepAType).toBe('choose');
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.answers).toHaveLength(6);
    expect(l.exerciseData.tutorSteps[0].answerKey).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.stepBTutorSteps[1].answerKey).toHaveLength(4);
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
    for (const [sentence, answer] of afterTruthEpisodes[l.lessonNumber as 1].choose) expect(requireDefined(sentence.match(/\(([^)]+)\)/)?.[1], "sentence.match(/\\(([^)]+)\\)/)?.[1]").split(' / ')).toContain(answer);
    for (const item of afterTruthEpisodes[l.lessonNumber as 1].choices) expect(item[item[3] === 'A' ? 1 : 2]).not.toBe(item[item[3] === 'A' ? 2 : 1]);
  }
});
test('reading missions supply fresh evidence without assuming permission or reconciliation', () => {
  for (const l of [lessons[2], lessons[6]]) {
    expect(l.missionData.readingPassage.blocks[0].content).not.toBe(l.applyData.readingText);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  const gathering = lessons[2].missionData.readingPassage.blocks[0].content;
  expect(gathering).toContain('before six');
  expect(gathering).toContain('I do not want a group meal');
  expect(gathering).toContain('ask me before sharing');
  const letter = lessons[6].missionData.readingPassage.blocks[0].content;
  expect(letter).toContain('Yes, you can give me');
  expect(letter).toContain('Saturday at four');
  expect(letter).toContain('does not mean we are getting back together');
  expect(letter).toContain('Let him speak directly');
});
test('the breakup occurs only in the finale and Bristol remains an unaccepted opportunity', () => {
  expect(lessons[3].storyData.currentEpisodeSummary).toContain('has not decided');
  expect(lessons[5].missionData.tutorSteps[1].tips[1].text).toContain('or imply a new romance with Nao');
  const last = lessons[7];
  expect(last.missionData.situation).toContain('has decided not to continue');
  expect(last.missionData.situation).toContain('email has not arrived yet');
  expect(last.applyData.dialogueLines.map((l: any) => l.text).join(' ')).toContain('I don\'t think I can continue');
  expect(last.missionData.tutorSteps[1].scripts.map((s: any) => s.text).join(' ')).toContain('Please do not keep messaging');
  expect(last.storyData.nextEpisodeHook).toContain('Later that evening');
  expect(last.storyData.nextEpisodeHook).toContain('former manager in Bristol');
  expect(last.storyData.nextEpisodeHook).toContain('has not accepted a job or decided to move');
  expect(last.storyData.nextEpisodeHook).not.toContain('reference outline');
});
test('earlier chapters, fixed feedback, existing IDs and empty artwork remain unchanged', () => {
  const before = buildTwoCitiesChapter();
  buildAfterTruthChapter();
  expect(buildTwoCitiesChapter()).toEqual(before);
  for (const l of lessons) {
    expect(l.backgroundImage).toBe('');
    expect(l.introductionData.introImage).toBe('');
    expect(l.applyData.situationImage).toBe('');
    expect(l.applyData.triviaImage).toBe('');
    expect(l.missionData.image).toBe('');
    expect(JSON.stringify(l)).not.toMatch(/https?:\/\/[^" ]+\.(?:png|webp|jpe?g)/i);
  }
  const previous = { id: 'preserve-existing-id', status: 'draft', feedbackData: { ...lessons[0].feedbackData, categories: [{ title: 'KEEP' }] } };
  const frozen = JSON.stringify(previous);
  const l = buildAfterTruthLesson(1, previous);
  expect(l.id).toBe(previous.id);
  expect(l.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(JSON.stringify(previous)).toBe(frozen);
  const checkpoints = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(checkpoints.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L4-C1-5-review', 'conversational-skills-L4-C1-10-review']);
});
