import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildDifficultChoicesChapter, buildDifficultChoicesLesson, difficultChoicesEpisodes, difficultChoicesId } from '../content/conversational-skills/ja/level-5-chapter-4/build';
import { missingProposalEpisodes } from '../content/conversational-skills/ja/level-5-chapter-3/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { languageEpisodeErrors, wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildDifficultChoicesChapter();

test('Difficult Choices uses eight draft slots, the agreed skills and owner language target', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const number of storyLessonNumbers) {
    const l = lessons.find(l => l.lessonNumber === number);
    expect([l.id, l.level, l.chapter, l.status, l.chapterName]).toEqual([difficultChoicesId(number), 5, 4, 'draft', 'Difficult Choices']);
    expect(l.storyData.storyTitle).toBe('Tokyo After Hours');
    expect(l.authoringLanguageTarget).toBe('TOEIC 225-545');
    expect(languageEpisodeErrors(difficultChoicesEpisodes[number], 5, l.skill)).toEqual([]);
    expect(conversationalLessonErrors(l)).toEqual([]);
    expect(l.goalTextEn).toMatch(/^I can /);
    expect(wordCount(l.goalTextEn)).toBeLessThanOrEqual(15);
  }
});

test('saved authoring corrections keep objective first, separate fields and tutor-first natural roles', () => {
  for (const number of storyLessonNumbers) {
    const l = lessons.find(l => l.lessonNumber === number), e = difficultChoicesEpisodes[number];
    const intro = l.introductionData.lessonGoalSteps;
    expect(intro).toHaveLength(4);
    expect(intro[0].script).toMatch(/^Our lesson objective today is to .+ Is it clear\?$/);
    expect(intro[1].script).toBe(`Here is our situation. ${e.intro[0]}`);
    expect(l.applyData.situationText).not.toMatch(/<[^>]+>|\n\s*\d+\./);
    expect(l.applyData.situationTranslation).toBe(e.apply.situation[1]);
    expect(l.applyData.tutorSteps[1].questions).toEqual(e.apply.questions.map(([question, answer]) => ({ question, answer })));
    const roleStep = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(roleStep.instruction).toContain('tutor speaks first');
    expect(roleStep.scripts[0].text).toContain(`I'll be ${e.mission.roles[0]}. Please be ${e.mission.roles[1]}`);
    expect(roleStep.scripts[1].text).toBe(`1. ${e.mission.lines[0]}`);
    expect(e.mission.lines[0]).not.toMatch(/Tell me one thing|What can you ask me|Explain the roleplay/i);
    expect(l.missionData.situation).toMatch(/^You are Mika\. Your tutor is /);
    if (l.skill === 'speaking') {
      expect(l.applyData.dialogueLines).toHaveLength(10);
      l.applyData.dialogueLines.forEach((line: any, i: number) => expect(line.speaker).toBe(e.apply.roles![i % 2]));
      expect(wordCount(l.applyData.dialogueLines.map((v: any) => v.text).join(' '))).toBeLessThanOrEqual(115);
    }
  }
});

test('standard support sections, fixed feedback guides and observed-error tracking remain available', () => {
  for (const l of lessons) {
    const learn = l.learnData.steps[0];
    expect(learn.vocabularyItems).toHaveLength(6);
    expect(learn.tutorSteps).toHaveLength(5);
    expect(learn.discussionPart.tutorSteps).toHaveLength(5);
    expect(learn.pronunciationPart.tutorSteps).toHaveLength(5);
    expect(l.stepBData.grammarTip.explanations).toHaveLength(2);
    expect(l.stepBData.grammarTip.tutorSteps).toHaveLength(2);
    expect(l.applyData.tutorSteps).toHaveLength(2);
    expect(l.applyData.triviaTutorSteps).toHaveLength(4);
    expect(l.missionData.tutorSteps).toHaveLength(l.skill === 'speaking' ? 3 : 4);
    expect(l.missionData.grammarTipItems).toHaveLength(5);
    expect(l.missionData2.topics).toHaveLength(3);
    expect(l.feedbackData.tutorSteps).toHaveLength(6);
    expect(l.feedbackData.categories.map((v: any) => v.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    expect(l.feedbackData.rubricLevels.map((v: any) => v.score)).toEqual([4, 3, 2, 1]);
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
    for (const value of [l.goalTextJp, l.introductionData.introTexts[1].text, l.applyData.situationTranslation, l.applyData.triviaTranslation, l.missionData.situationTranslation, l.missionData.instructionTranslation, ...learn.vocabularyItems.map((v: any) => v.translation)]) expect(value).toMatch(/[ぁ-んァ-ン\p{Script=Han}]/u);
  }
});

test('listening messages are short, distinct and only stored in tutor guides', () => {
  const l = lessons[1];
  const scripts = [l.applyData.tutorSteps[0].listeningScript, l.missionData.tutorSteps[1].listeningScript];
  expect(scripts[0]).not.toBe(scripts[1]);
  for (const script of scripts) expect(wordCount(script)).toBeLessThanOrEqual(70);
  expect(scripts[0]).toContain('almost twenty percent higher');
  expect(scripts[0]).toContain('does not prove he changed');
  expect(scripts[1]).toContain('keep both reports unchanged');
  expect(scripts[1]).toContain('not found that research yet');
  expect(l.applyData.readingText).toBe('');
  expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.listeningScript).toBeUndefined();
  expect(l.missionData.readingPassage).toBeUndefined();
});

test('reading challenges have complete fresh evidence and do not promise outcomes', () => {
  for (const l of lessons.filter(l => l.skill === 'reading')) {
    const e = difficultChoicesEpisodes[l.lessonNumber as 3];
    const passage = l.missionData.readingPassage.blocks[0].content;
    expect(passage).toBe(e.mission.text);
    expect(passage).not.toBe(l.applyData.readingText);
    expect(wordCount(passage)).toBeLessThanOrEqual(145);
    expect(wordCount(l.applyData.readingText)).toBeLessThanOrEqual(145);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  const work = lessons[2].missionData.readingPassage.blocks[0].content;
  expect(work).toContain('five working days');
  expect(work).toContain('does not mean the figures have already been checked');
  expect(work).toContain('has not confirmed the contract');
  const note = lessons[6].missionData.readingPassage.blocks[0].content;
  expect(note).toContain('Maybe you are right');
  expect(note).toContain('does not mean all his concerns have disappeared');
  expect(note).toContain('Keep the discussion confidential');
});

test('six Step A and four Step B keys match the actual rendered options', () => {
  for (const number of storyLessonNumbers) {
    const l = lessons.find(l => l.lessonNumber === number), e = difficultChoicesEpisodes[number];
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.answers.map((v: any) => v.text)).toEqual(e.choose.map(v => v[1]));
    expect(l.exerciseData.tutorSteps[0].answerKey.map((v: any) => v.text)).toEqual(e.choose.map((v, i) => `${i + 1}. ${v[1]}`));
    expect(l.exerciseData.stepBTutorSteps[1].answerKey.map((v: any) => v.text)).toEqual(e.choices.map((v, i) => `${i + 1}. ${v[3]} - ${v[v[3] === 'A' ? 1 : 2]}`));
    e.choose.forEach(([sentence, answer]) => expect(sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ') || []).toContain(answer));
    e.words.forEach(([sentence, phrase]) => expect(sentence.toLowerCase()).toContain(phrase.toLowerCase()));
  }
});

test('continuity starts at Chapter 3 and retains the earlier concern without making it proof', () => {
  expect(lessons[0].storyData.previousSummary).toBe(missingProposalEpisodes[9].closing);
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(difficultChoicesEpisodes[storyLessonNumbers[i - 1]!].closing);
  expect(lessons[3].applyData.dialogueLines[0].text).toContain('last year');
  expect(lessons[3].applyData.dialogueLines[6].text).toContain('lacked evidence');
  expect(lessons[3].missionData.tutorSteps[1].tips[1].text).toContain('not an established fraud');
});

test('removal-request document is not compliance permission and Mika preserves the records', () => {
  const l = lessons[4];
  expect(l.applyData.dialogueLines[5].text).toContain('keep project records unchanged');
  expect(l.applyData.dialogueLines[7].text).toContain('written confirmation');
  expect(l.applyData.dialogueLines[8].text).toContain('will discuss');
  expect(l.applyData.dialogueLines[9].text).toContain('keep the records unchanged');
  expect(l.missionData.situation).toContain('Written confirmation is not yet available');
  expect(l.missionData.tutorSteps[1].tips[1].text).toContain('removal request, not confirmation');
  const followup = lessons[5];
  expect(followup.applyData.dialogueLines[1].text).toContain('approval is there');
  expect(followup.applyData.dialogueLines[1].text).toContain('review record is missing');
  expect(followup.applyData.dialogueLines[7].text).toContain('kept them unchanged');
  expect(followup.missionData.tutorSteps[1].tips[1].text).toContain('possible, not established');
});

test('final account, download, email and acquired-company clues leave responsibility and intent open', () => {
  const l = lessons[7];
  expect(l.introductionData.introTexts[0].text).toContain('account, but its user is unknown');
  expect(l.introductionData.introTexts[0].text).toContain('downloaded shortly before');
  expect(l.introductionData.introTexts[0].text).toContain('envelope');
  expect(l.introductionData.introTexts[0].text).toContain('three-week-old email');
  expect(l.applyData.dialogueLines[0].text).toContain('original forecasts outside');
  expect(l.applyData.dialogueLines[2].text).toContain('independent review');
  expect(l.applyData.dialogueLines[6].text).toContain('company Northstar acquired last year');
  expect(l.applyData.dialogueLines[8].text).toContain('He says he did not');
  expect(l.applyData.dialogueLines[4].text).toContain('client questioned our numbers');
  expect(l.missionData.tutorSteps[1].tips[1].text).toContain('client doubts were the stated reason');
  expect(l.storyData.nextEpisodeHook).toContain('If Ethan sent the files');
  expect(l.storyData.nextEpisodeHook).toContain('was he deceived');
  expect(l.storyData.nextEpisodeHook).toContain('remain unresolved');
});

test('builders preserve caller identity and fixed feedback, clear stale branches, and add no artwork', () => {
  const previous = { id: 'keep-id', status: 'published', feedbackData: { ...lessons[0].feedbackData, categories: [{ title: 'KEEP' }] }, missionData: { listeningScript: 'obsolete', readingPassage: { title: 'obsolete' } } };
  const copy = JSON.stringify(previous);
  const l = buildDifficultChoicesLesson(1, previous);
  expect(l.id).toBe('keep-id');
  expect(l.status).toBe('published');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]);
  expect(l.missionData.listeningScript).toBeUndefined();
  expect(l.missionData.readingPassage).toBeUndefined();
  expect(JSON.stringify(previous)).toBe(copy);
  for (const item of lessons) {
    expect(item.backgroundImage).toBe('');
    expect(item.introductionData.introImage).toBe('');
    expect(item.applyData.situationImage).toBe('');
    expect(item.applyData.triviaImage).toBe('');
    expect(item.missionData.image).toBe('');
    const { storyData, ...facing } = item;
    expect(JSON.stringify(facing)).not.toMatch(/https?:\/\/[^" ]+\.(?:png|webp|jpe?g)|You may play|invented adult|No personal or romantic|\bmonologue\b|boyfriend|girlfriend|\bdating\b/i);
  }
});

test('only dynamic checkpoints occupy 5/10 and persistence uses the calibrated Chapter 4 builder', () => {
  const withReviews = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(withReviews.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L5-C4-5-review', 'conversational-skills-L5-C4-10-review']);
  const updater = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(updater).toContain("'5:4': { title: 'Difficult Choices'");
  expect(updater).toContain('level === 5 && [3, 4, 5].includes(chapter) ? definition.build');
  expect(updater).toContain('Concurrent edit detected');
  expect(updater).toContain('Full record read-back mismatch');
});
