import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildPriceOfTruthChapter, buildPriceOfTruthLesson, priceOfTruthEpisodes, priceOfTruthId } from '../content/conversational-skills/ja/level-5-chapter-5/build';
import { difficultChoicesEpisodes } from '../content/conversational-skills/ja/level-5-chapter-4/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { languageEpisodeErrors, wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildPriceOfTruthChapter();
const episode = (n: number) => priceOfTruthEpisodes[n as typeof storyLessonNumbers[number]];
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);
const facing = (n: number) => {
  const { storyData, ...content } = lesson(n);
  return JSON.stringify(content);
};

test('The Price of Truth has eight regular drafts at the owner TOEIC target, not the reference CEFR label', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = episode(n);
    expect([l.id, l.level, l.chapter, l.status]).toEqual([priceOfTruthId(n), 5, 5, 'draft']);
    expect(l.chapterName).toBe('The Price of Truth');
    expect(l.storyData.storyTitle).toBe('Tokyo After Hours');
    expect(l.authoringLanguageTarget).toBe('TOEIC 225-545');
    expect(languageEpisodeErrors(e, 5, l.skill)).toEqual([]);
    expect(conversationalLessonErrors(l)).toEqual([]);
    expect(wordCount(l.goalTextEn)).toBeLessThanOrEqual(15);
    expect(facing(n)).not.toMatch(/B2[–-]C1|\bmonologue\b|You may play|invented adult|No personal or romantic|\b(?:boyfriend|girlfriend|dating|kiss(?:ed|ing)?)\b/i);
  }
});

test('standard numbered tutor guides keep objective first, plain situation fields and separate Japanese support', () => {
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = episode(n), learn = l.learnData.steps[0];
    expect(l.introductionData.lessonGoalSteps).toHaveLength(4);
    expect(l.introductionData.lessonGoalSteps[0].script).toMatch(/^Our lesson objective today is to .+ Is it clear\?$/);
    expect(l.introductionData.lessonGoalSteps[1].script).toBe(`Here is our situation. ${e.intro[0]}`);
    expect(l.applyData.situationText).not.toMatch(/<[^>]+>|\n\s*\d+\./);
    expect(l.applyData.situationTranslation).toBe(e.apply.situation[1]);
    expect(l.applyData.tutorSteps[1].questions).toEqual(e.apply.questions.map(([question, answer]) => ({ question, answer })));
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
    for (const text of [l.goalTextJp, l.introductionData.introTexts[1].text, l.applyData.situationTranslation, l.applyData.triviaTranslation, l.missionData.situationTranslation, l.missionData.instructionTranslation, ...learn.vocabularyItems.map((v: any) => v.translation)]) expect(text).toMatch(/[ぁ-んァ-ン\p{Script=Han}]/u);
  }
});

test('speaking uses short alternating dialogues and natural tutor-first direct roles', () => {
  for (const l of lessons) {
    const e = episode(l.lessonNumber);
    const roleStep = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(roleStep.instruction).toContain('tutor speaks first');
    const tutorRole = l.lessonNumber === 7 ? 'the hotel representative' : l.lessonNumber === 9 ? 'the new employee' : e.mission.roles[0];
    expect(roleStep.scripts[0].text).toContain(`I'll be ${tutorRole}. Please be ${e.mission.roles[1]}`);
    expect(roleStep.scripts[1].text).toBe(`1. ${e.mission.lines[0]}`);
    expect(l.missionData.situation).toMatch(/^You are Mika\. Your tutor is /);
    expect(e.mission.lines[0]).not.toMatch(/Tell me one thing|What can you ask me|Explain the roleplay/i);
    if (l.skill !== 'speaking') continue;
    expect(l.applyData.dialogueLines).toHaveLength(10);
    l.applyData.dialogueLines.forEach((line: any, i: number) => expect(line.speaker).toBe(e.apply.roles![i % 2]));
    expect(wordCount(l.applyData.dialogueLines.map((v: any) => v.text).join(' '))).toBeLessThanOrEqual(115);
  }
});

test('listening scripts are short, distinct and private, with reasons separated from email evidence', () => {
  const l = lesson(2);
  const scripts = [l.applyData.tutorSteps[0].listeningScript, l.missionData.tutorSteps[1].listeningScript];
  expect(scripts[0]).not.toBe(scripts[1]);
  for (const script of scripts) expect(wordCount(script)).toBeLessThanOrEqual(70);
  expect(scripts[0]).toContain('two months before the review');
  expect(scripts[0]).toContain('He did not answer');
  expect(scripts[1]).toContain('separate Kuroda’s reasons from our evidence');
  expect(l.applyData.readingText).toBe('');
  expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.listeningScript).toBeUndefined();
  expect(l.missionData.readingPassage).toBeUndefined();
  expect(l.missionData.tutorSteps[2].tips[1].text).toContain('Silence is not a confession');
});

test('reading missions use fresh visible notes with all facts needed for the challenge', () => {
  for (const l of lessons.filter(l => l.skill === 'reading')) {
    const passage = l.missionData.readingPassage.blocks[0].content;
    expect(passage).toBe(episode(l.lessonNumber).mission.text);
    expect(passage).not.toBe(l.applyData.readingText);
    expect(wordCount(passage)).toBeLessThanOrEqual(145);
    expect(wordCount(l.applyData.readingText)).toBeLessThanOrEqual(145);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  const correction = lesson(3).missionData.readingPassage.blocks[0].content;
  expect(correction).toContain('Keep both versions');
  expect(correction).toContain('market research');
  expect(correction).toContain('not by itself show that he intended Northstar');
  const handover = lesson(8).missionData.readingPassage.blocks[0].content;
  expect(handover).toContain('not a contract award');
  expect(handover).toContain('still needs to complete extra training');
  expect(handover).toContain('rules are not described as finished');
  expect(handover).toContain('proper company channels');
});

test('all exercise keys align with options and actual-error assessment guidance remains intact', () => {
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = episode(n);
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.answers.map((v: any) => v.text)).toEqual(e.choose.map(v => v[1]));
    expect(l.exerciseData.tutorSteps[0].answerKey.map((v: any) => v.text)).toEqual(e.choose.map((v, i) => `${i + 1}. ${v[1]}`));
    expect(l.exerciseData.stepBTutorSteps[1].answerKey.map((v: any) => v.text)).toEqual(e.choices.map((v, i) => `${i + 1}. ${v[3]} - ${v[v[3] === 'A' ? 1 : 2]}`));
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
    expect(l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2].tips[2].text).toContain('Do not invent weaknesses');
    e.choose.forEach(([sentence, answer]) => expect(sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ') || []).toContain(answer));
    e.words.forEach(([sentence, phrase]) => expect(sentence.toLowerCase()).toContain(phrase.toLowerCase()));
  }
});

test('continuity reveals the route, notice, motive and consequences only at their stated stages', () => {
  expect(lesson(1).storyData.previousSummary).toBe(difficultChoicesEpisodes[9].closing);
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(episode(storyLessonNumbers[i - 1]!).closing);
  expect(episode(1).apply.dialogue?.[4]?.[1]).toContain('Northstar’s strategy department');
  expect(episode(1).mission.evidence).toContain('Do not identify the person who created');
  expect(episode(2).mission.evidence).toContain('does not yet contain his admission of knowledge');
  expect(episode(3).apply.text).toContain('despite earlier concerns');
  expect(episode(4).intro[0]).toContain('denies wanting a rival bid team');
  expect(episode(4).intro[0]).toContain('suspended while a final decision is pending');
  expect(episode(4).mission.evidence).toContain('Do not announce dismissal');
  expect(episode(8).apply.text).toContain('Kuroda’s employment ended');
  expect(episode(8).apply.text).toContain('Northstar dismissed the consultant');
});

test('client trust is rebuilt gradually and the contract win occurs only in the final episode', () => {
  expect(episode(6).apply.dialogue?.[9]?.[1]).toContain('actions as well as words');
  expect(episode(7).apply.dialogue?.[3]?.[1]).toContain('approval checks and limited access');
  expect(episode(7).closing).toContain('without a final decision');
  expect(episode(8).apply.text).toContain('continue considering');
  expect(episode(8).apply.text).toContain('not yet been awarded');
  expect(episode(9).intro[0]).toContain('Three months later');
  expect(episode(9).intro[0]).toContain('after a fresh review');
  expect(episode(9).closing).toContain('Tokyo After Hours ends');
});

test('final challenge explicitly changes from dinner partner to a new employee, with no invented directions', () => {
  const l = lesson(9);
  expect(l.applyData.dialogueLines[0].speaker).toBe('Ethan');
  expect(l.missionData.situation).toMatch(/^You are Mika\. Your tutor is the new employee\./);
  expect(l.missionData.tutorSteps[1].scripts[0].text).toContain("I'll be the new employee. Please be Mika");
  expect(l.missionData.tutorSteps[1].scripts[1].text).toContain('It is my first day');
  expect(l.missionData.grammarTipItems).toContain('Do not be afraid to ask questions.');
  expect(episode(9).mission.evidence).toContain('Do not share private disciplinary details');
  expect(episode(9).mission.evidence).toContain('rather than inventing a floor or room');
});

test('new drafts have no artwork and rebuilding preserves identity, media, status, fixed feedback and caller notes', () => {
  for (const l of lessons) {
    expect(l.backgroundImage).toBe('');
    expect(l.introductionData.introImage).toBe('');
    expect(l.applyData.situationImage).toBe('');
    expect(l.applyData.triviaImage).toBe('');
    expect(l.missionData.image).toBe('');
  }
  const previous = { id: 'keep-id', status: 'published', createdAt: 'keep-date', studentNotes: 'keep-note', backgroundImage: '/keep-background.webp',
    introductionData: { introImage: '/keep-intro.webp' },
    learnData: { steps: [{ vocabularyItems: [{ image: '/keep-word.webp' }], discussionPart: { images: ['/keep-discussion.webp'] } }] },
    applyData: { situationImage: '/keep-apply.webp', triviaImage: '/keep-trivia.webp' },
    missionData: { image: '/keep-mission.webp', listeningScript: 'obsolete', readingPassage: { title: 'obsolete' } },
    feedbackData: { ...lesson(1).feedbackData, categories: [{ title: 'KEEP' }], rubricTitle: 'KEEP TITLE' } };
  const before = JSON.stringify(previous), l = buildPriceOfTruthLesson(1, previous);
  expect(l.id).toBe('keep-id');
  expect(l.status).toBe('published');
  expect(l.createdAt).toBe('keep-date');
  expect(l.studentNotes).toBe('keep-note');
  expect(l.backgroundImage).toBe(previous.backgroundImage);
  expect(l.introductionData.introImage).toBe(previous.introductionData.introImage);
  expect(l.learnData.steps[0].vocabularyItems[0].image).toBe('/keep-word.webp');
  expect(l.learnData.steps[0].discussionPart.images).toEqual(['/keep-discussion.webp']);
  expect(l.applyData.situationImage).toBe(previous.applyData.situationImage);
  expect(l.applyData.triviaImage).toBe(previous.applyData.triviaImage);
  expect(l.missionData.image).toBe(previous.missionData.image);
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]);
  expect(l.feedbackData.rubricTitle).toBe('KEEP TITLE');
  expect(l.missionData.listeningScript).toBeUndefined();
  expect(l.missionData.readingPassage).toBeUndefined();
  expect(JSON.stringify(previous)).toBe(before);
});

test('only dynamic checkpoints fill 5/10 and guarded persistence supports Chapter 5 without a model call', () => {
  const withReviews = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(withReviews.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L5-C5-5-review', 'conversational-skills-L5-C5-10-review']);
  const updater = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(updater).toContain("'5:5': { title: 'The Price of Truth'");
  expect(updater).toContain('level === 5 && [3, 4, 5].includes(chapter) ? definition.build');
  expect(updater).toContain('Concurrent edit detected');
  expect(updater).toContain('Full record read-back mismatch');
  const source = readFileSync(new URL('../content/conversational-skills/ja/level-5-chapter-5/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/new OpenAI|chat\.completions|responses\.create|fetch\(|API_KEY/);
});
