import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildMissingProposalChapter, buildMissingProposalLesson, missingProposalEpisodes, missingProposalId } from '../content/conversational-skills/ja/level-5-chapter-3/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { languageEpisodeErrors, wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildMissingProposalChapter();

test('The Missing Proposal has eight regular lessons in the agreed slots and skills', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const l of lessons) {
    expect(l.id).toBe(missingProposalId(l.lessonNumber));
    expect([l.level, l.chapter, l.status, l.chapterName]).toEqual([5, 3, 'draft', 'The Missing Proposal']);
    expect(conversationalLessonErrors(l)).toEqual([]);
    expect(languageEpisodeErrors(missingProposalEpisodes[l.lessonNumber as 1], 5, l.skill)).toEqual([]);
    expect(l.authoringLanguageTarget).toBe('TOEIC 225-545');
    expect(l.goalTextEn).toMatch(/^I can /);
    expect(wordCount(l.goalTextEn)).toBeLessThanOrEqual(15);
    expect(l.storyData.storyNotes).toContain('not a CEFR equivalence');
  }
});

test('guides, support sections and observed-error notes follow the shared lesson standard', () => {
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
    expect(l.missionData.grammarTipItems).toHaveLength(5);
    expect(l.missionData2.topics).toHaveLength(3);
    expect(l.feedbackData.tutorSteps).toHaveLength(6);
    expect(l.feedbackData.categories.map((c: any) => c.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    expect(l.feedbackData.rubricLevels.map((r: any) => r.score)).toEqual([4, 3, 2, 1]);
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
    for (const value of [l.goalTextJp, l.introductionData.introTexts[1].text, l.applyData.situationTranslation, l.applyData.triviaTranslation, l.missionData.situationTranslation, l.missionData.instructionTranslation, ...learn.vocabularyItems.map((v: any) => v.translation)]) expect(value).toMatch(/[ぁ-んァ-ン\p{Script=Han}]/u);
  }
});

test('speaking is short alternating tutor-first dialogue with direct named roles', () => {
  for (const l of lessons.filter(l => l.skill === 'speaking')) {
    const e = missingProposalEpisodes[l.lessonNumber as 1];
    expect(l.applyData.dialogueLines).toHaveLength(10);
    expect(wordCount(l.applyData.dialogueLines.map((v: any) => v.text).join(' '))).toBeLessThanOrEqual(115);
    l.applyData.dialogueLines.forEach((line: any, i: number) => expect(line.speaker).toBe(e.apply.roles![i % 2]));
    expect(l.missionData.situation).toMatch(/^You are Mika/);
    expect(l.missionData.tutorSteps[1].instruction).toContain('tutor speaks first');
    expect(l.missionData.tutorSteps[1].scripts[0].text).toContain(`I'll be ${e.mission.roles[0]}`);
    expect(l.missionData.readingPassage).toBeUndefined();
  }
});

test('both listening messages are short, distinct and stored only in tutor guides', () => {
  const l = lessons[1];
  const scripts = [l.applyData.tutorSteps[0].listeningScript, l.missionData.tutorSteps[1].listeningScript];
  expect(scripts[0]).not.toBe(scripts[1]);
  for (const script of scripts) expect(wordCount(script)).toBeLessThanOrEqual(70);
  expect(scripts[0]).toContain('Opening it does not prove');
  expect(scripts[1]).toContain('room B at ten tomorrow');
  expect(scripts[1]).toContain('old and new reports unchanged');
  expect(l.applyData.readingText).toBe('');
  expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.listeningScript).toBeUndefined();
  expect(l.missionData.readingPassage).toBeUndefined();
});

test('reading challenges provide fresh, visible evidence for every new task', () => {
  for (const l of lessons.filter(l => l.skill === 'reading')) {
    const e = missingProposalEpisodes[l.lessonNumber as 1];
    const passage = l.missionData.readingPassage.blocks[0].content;
    expect(passage).toBe(e.mission.text);
    expect(passage).not.toBe(l.applyData.readingText);
    expect(wordCount(l.applyData.readingText)).toBeLessThanOrEqual(145);
    expect(wordCount(passage)).toBeLessThanOrEqual(145);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  expect(lessons[2].missionData.readingPassage.blocks[0].content).toContain('no outside recipient');
  expect(lessons[6].missionData.readingPassage.blocks[0].content).toContain('three this afternoon');
  expect(lessons[6].missionData.readingPassage.blocks[0].content).toContain('before anything goes to the client');
});

test('all six Step A and four Step B answers match the rendered exercise items', () => {
  for (const l of lessons) {
    const e = missingProposalEpisodes[l.lessonNumber as 1];
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.answers.map((v: any) => v.text)).toEqual(e.choose.map(v => v[1]));
    expect(l.exerciseData.tutorSteps[0].answerKey).toHaveLength(6);
    expect(l.exerciseData.stepBTutorSteps[1].answerKey.map((v: any) => v.text)).toEqual(e.choices.map((v, i) => `${i + 1}. ${v[3]} - ${v[v[3] === 'A' ? 1 : 2]}`));
    e.choose.forEach(([sentence, answer]) => expect(sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ') || []).toContain(answer));
    e.words.forEach(([sentence, phrase]) => expect(sentence.toLowerCase()).toContain(phrase.toLowerCase()));
  }
});

test('continuity preserves the clue, interview, internal correction and matching old calculation error', () => {
  expect(lessons[0].storyData.previousSummary).toContain('older report disappeared');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(missingProposalEpisodes[storyLessonNumbers[i - 1]!].closing);
  expect(lessons[0].applyData.dialogueLines[5].text).toContain('old report');
  expect(lessons[2].applyData.readingText).toContain('only for our team');
  expect(lessons[2].applyData.readingText).toContain('sent a correction immediately');
  expect(lessons[3].applyData.dialogueLines[2].text).toContain('Everyone');
  expect(lessons[4].applyData.dialogueLines[1].text).toContain('mistake matches');
  expect(lessons[4].applyData.dialogueLines[2].text).toContain('three weeks ago');
  expect(lessons[4].missionData.tutorSteps[1].tips[1].text).toContain('possibility, not a confirmed event');
});

test('the client outcome and final account user remain unknown, including Kuroda’s roleplay', () => {
  expect(lessons[5].missionData.tutorSteps[1].tips[1].text).toContain('Do not say approval proves a leak');
  expect(lessons[6].applyData.readingText).toContain('No final decision');
  expect(lessons[7].applyData.dialogueLines[2].text).toContain('extra access');
  expect(lessons[7].applyData.dialogueLines[6].text).toContain('after the senior management review');
  expect(lessons[7].missionData.situation).toContain('user is unknown');
  expect(lessons[7].missionData.tutorSteps[1].scripts[0].text).toContain('Director Kuroda');
  expect(lessons[7].missionData.tutorSteps[1].tips[1].text).toContain('without adding threats or a confession');
  expect(lessons[7].storyData.nextEpisodeHook).toContain('The mystery remains open');
  const learnerContent = lessons.map(({ storyData, ...content }) => content);
  expect(JSON.stringify(learnerContent)).not.toMatch(/You may play|invented adult|No personal or romantic|\bmonologue\b|\bkiss(?:ed|es|ing)?\b|\bdating\b|boyfriend|girlfriend/i);
});

test('authoring preserves existing identities, fixed rubric and caller data and adds no images', () => {
  const previous = { id: 'keep-id', status: 'published', feedbackData: { ...lessons[0].feedbackData, categories: [{ title: 'KEEP' }] } };
  const copy = JSON.stringify(previous);
  const l = buildMissingProposalLesson(1, previous);
  expect(l.id).toBe(previous.id);
  expect(l.status).toBe('published');
  expect(l.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(JSON.stringify(previous)).toBe(copy);
  for (const item of lessons) {
    expect(item.backgroundImage).toBe('');
    expect(item.introductionData.introImage).toBe('');
    expect(item.applyData.situationImage).toBe('');
    expect(item.applyData.triviaImage).toBe('');
    expect(item.missionData.image).toBe('');
    expect(JSON.stringify(item)).not.toMatch(/https?:\/\/[^" ]+\.(?:png|webp|jpe?g)/i);
  }
});

test('only dynamic checkpoints fill slots 5/10 and guarded persistence targets Chapter 3', () => {
  const list = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(list.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L5-C3-5-review', 'conversational-skills-L5-C3-10-review']);
  const source = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(source).toContain("'5:3': { title: 'The Missing Proposal'");
  expect(source).toContain('Concurrent edit detected');
  expect(source).toContain('Full record read-back mismatch');
  expect(source).not.toContain("'5:2':");
});
