import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildTwoCitiesChapter, buildTwoCitiesLesson, chapter5Episodes, chapter5Id } from '../content/conversational-skills/ja/level-3-chapter-5/build';
import { buildCareerChapter } from '../content/conversational-skills/ja/level-3-chapter-4/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildTwoCitiesChapter();
test('Chapter 5 maps the eight episodes to story slots and the established skill pattern', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.lessonName)).toEqual(['A New Beginning in Osaka', 'Lunch with Ren', 'Working Late', 'More Than Friends?', 'A Broken Promise', 'A Choice to Regret', 'Keeping Secrets', 'The Truth Comes Out']);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const l of lessons) {
    expect(l.id).toBe(chapter5Id(l.lessonNumber));
    expect(l.chapter).toBe(5);
    expect(l.level).toBe(3);
    expect(l.chapterName).toBe('Two Cities, One Secret');
    expect(l.status).toBe('draft');
    expect(conversationalLessonErrors(l)).toEqual([]);
  }
});
test('the replaced incident is consistently the hidden dinner, with no physical-intimacy residue', () => {
  const text = JSON.stringify(lessons);
  expect(text).not.toMatch(/\bkiss(?:ed|es|ing)?\b|キス|口づけ|抱きしめ|embrace|hugged/i);
  const regret = lessons[5], advice = lessons[6], ending = lessons[7];
  for (const l of [regret, advice, ending]) expect(l.storyData.currentEpisodeSummary).toContain('dinner');
  expect(regret.missionData.situation).toContain('told Leo you were working');
  expect(advice.applyData.readingText).toContain('I told Leo I was working on Friday');
  expect(ending.applyData.dialogueLines[0].text).toContain('what dinner');
  expect(ending.missionData.situation).toContain('private dinner');
  expect(ending.storyData.nextEpisodeHook).toContain('neither has made a final decision');
});
test('approved hybrid terms continue Chapter 4 without changing its unresolved ending', () => {
  const before = buildCareerChapter();
  buildTwoCitiesChapter();
  expect(buildCareerChapter()).toEqual(before);
  expect(before[7].storyData.nextEpisodeHook).toContain('final answer has not arrived');
  expect(lessons[0].storyData.previousSummary).toContain('waiting for the final answer');
  expect(lessons[0].storyData.currentEpisodeSummary).toContain('approves');
  expect(lessons[0].storyData.currentEpisodeSummary).toContain('before the reply deadline');
  expect(lessons[0].missionData.situation).toContain('Mondays and Fridays');
  expect(lessons[0].missionData.tutorSteps[1].tips[1].text).toContain('Hybrid work is approved now');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(chapter5Episodes[requireDefined(storyLessonNumbers[i - 1], "storyLessonNumbers[i - 1]")].closing);
  expect(lessons[4].storyData.currentEpisodeSummary).toContain('extra Thursday');
  expect(lessons[5].storyData.currentEpisodeSummary).toStartWith('On Friday');
  expect(lessons[6].missionData.readingPassage.blocks[0].content).toContain('Sunday at 6 p.m.');
  expect(lessons[6].missionData.readingPassage.blocks[0].content).toContain('Monday at ten');
});
test('direct roles, Japanese support and standard tutor guides are complete', () => {
  for (const l of lessons) {
    const learn = l.learnData.steps[0];
    expect(l.missionData.situation).toStartWith('You are Emma');
    expect(JSON.stringify(l)).not.toMatch(/You may play|invented adult character|No personal or romantic|personal romantic disclosures|Please be Emma or/);
    expect(l.introductionData.lessonGoalSteps).toHaveLength(4);
    expect(learn.vocabularyItems).toHaveLength(6);
    expect(learn.tutorSteps).toHaveLength(5);
    expect(learn.discussionPart.tutorSteps).toHaveLength(5);
    expect(learn.pronunciationPart.tutorSteps).toHaveLength(5);
    expect(learn.pronunciationPart.leftColumn.words).toHaveLength(3);
    expect(learn.pronunciationPart.rightColumn.words).toHaveLength(3);
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
  expect(new Set(lessons.map(l => l.learnData.steps[0].pronunciationPart.leftColumn.soundSymbol)).size).toBe(4);
});
test('exercises have six and four keyed items and retain marking and note instructions', () => {
  for (const l of lessons) {
    expect(l.exerciseData.stepAType).toBe('choose');
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.answers).toHaveLength(6);
    expect(l.exerciseData.tutorSteps[0].answerKey).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.stepBTutorSteps[1].answerKey).toHaveLength(4);
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
    for (const [sentence, answer] of chapter5Episodes[l.lessonNumber as 1].choose) expect(requireDefined(sentence.match(/\(([^)]+)\)/)?.[1], "sentence.match(/\\(([^)]+)\\)/)?.[1]").split(' / ')).toContain(answer);
    for (const item of chapter5Episodes[l.lessonNumber as 1].choices) expect(item[item[3] === 'A' ? 1 : 2]).not.toBe(item[item[3] === 'A' ? 2 : 1]);
    expect(new Set(l.exerciseData.chooseItems.map((i: any) => i.sentence)).size).toBe(6);
  }
});
test('speaking remains short tutor-first dialogue and listening transcripts stay private', () => {
  for (const l of lessons.filter(l => l.skill === 'speaking')) {
    const lines = l.applyData.dialogueLines;
    expect(lines).toHaveLength(10);
    expect(lines.map((line: any) => line.text).join(' ').split(/\s+/).length).toBeLessThan(165);
    for (let i = 1; i < lines.length; i++) expect(lines[i].speaker).not.toBe(lines[i - 1].speaker);
    expect(l.missionData.tutorSteps[1].instruction).toContain('tutor speaks first');
    expect(l.missionData.tutorSteps[1].scripts[1].text).toStartWith('1.');
    expect(l.missionData.instruction).not.toMatch(/monologue|uninterrupted|90.second/);
  }
  const listening = lessons[1];
  expect(listening.applyData.readingText).toBe('');
  expect(listening.applyData.dialogueLines).toEqual([]);
  expect(listening.missionData.readingPassage).toBeUndefined();
  expect(listening.missionData.listeningScript).toBeUndefined();
  const scripts = [listening.applyData.tutorSteps[0].listeningScript, listening.missionData.tutorSteps[1].listeningScript];
  for (const text of scripts) expect(text.replace(/<[^>]*>/g, '').split(/\s+/).length).toBeLessThan(80);
  expect(scripts[0]).not.toBe(scripts[1]);
});
test('reading missions introduce fresh evidence and do not turn estimates or fears into facts', () => {
  const delay = lessons[2], advice = lessons[6];
  const latest = delay.missionData.readingPassage.blocks[0].content;
  expect(delay.applyData.readingText).toContain('by seven');
  expect(latest).toContain('deadline: 8 p.m.');
  expect(latest).toContain('8:30 p.m.; still an estimate');
  expect(latest).toContain('update by 7:30 p.m.');
  expect(latest).toContain('arrival time: not known yet');
  const notes = advice.missionData.readingPassage.blocks[0].content;
  expect(notes).toContain('Not known');
  expect(notes).toContain('Whether he will want to continue the relationship');
  expect(notes).toContain('not a new dinner invitation');
  for (const l of [delay, advice]) {
    expect(l.missionData.readingPassage.blocks[0].content).not.toBe(l.applyData.readingText);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
});
test('no artwork or premature outcome is introduced and the fixed rubric is preserved', () => {
  for (const l of lessons) {
    expect(l.backgroundImage).toBe('');
    expect(l.introductionData.introImage).toBe('');
    expect(l.applyData.situationImage).toBe('');
    expect(l.applyData.triviaImage).toBe('');
    expect(l.missionData.image).toBe('');
    expect(JSON.stringify(l)).not.toMatch(/https?:\/\/[^" ]+\.(?:png|webp|jpe?g)/i);
  }
  const final = lessons[7];
  expect(final.storyData.nextEpisodeHook).toContain('trust has not been repaired');
  expect(final.missionData.tutorSteps[1].tips[1].text).toContain('End unresolved');
  const previous = { id: 'existing-lesson-id', status: 'draft', feedbackData: { ...lessons[0].feedbackData, categories: [{ title: 'PRESERVED' }] } };
  const frozen = JSON.stringify(previous);
  const rebuilt = buildTwoCitiesLesson(1, previous);
  expect(rebuilt.id).toBe(previous.id);
  expect(rebuilt.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(JSON.stringify(previous)).toBe(frozen);
});
test('checkpoint slots stay dynamic and chapter-specific', () => {
  const previews = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(previews.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L3-C5-5-review', 'conversational-skills-L3-C5-10-review']);
  expect(addAvailableCheckpoints(lessons.filter(l => l.status === 'published')).filter(l => [5, 10].includes(l.lessonNumber))).toHaveLength(0);
});
