import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildTraditionsChapter, buildTraditionsLesson, traditionsEpisodes, traditionsId } from '../content/conversational-skills/en/level-6-chapter-1/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { conversationalLanguageInstructions, conversationalLanguageTarget, clearConversationalTranslations } from '../../shared/conversationalLanguage';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { addAvailableCheckpoints, buildCheckpointLesson, checkpointPrompt, checkpointSlot, summarizeCheckpointEvidence, validateCheckpointContent } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildTraditionsChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);
const jp = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const plain = (s: string) => s.replace(/<[^>]*>/g, '');

test('Level 6 Chapter 1 follows the five-chapter structure and the owner TOEIC 550-780 band', () => {
  expect(conversationalLanguageTarget(6)).toMatchObject({ toeicMin: 550, toeicMax: 780, supportLanguage: 'en', stepAType: 'expressions', stepAItemCount: 4 });
  expect(conversationalLanguageTarget(3)).toMatchObject({ toeicMin: 10, toeicMax: 220, supportLanguage: 'ja' });
  for (const n of [4, 5]) expect(conversationalLanguageTarget(n)).toMatchObject({ toeicMin: 225, toeicMax: 545, stepAItemCount: 6 });
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const n of storyLessonNumbers) {
    const l = lesson(n);
    expect([l.id, l.level, l.chapter, l.status]).toEqual([traditionsId(n), 6, 1, 'draft']);
    expect(l.chapterName).toBe('Keeping Traditions Alive');
    expect(l.storyData.storyTitle).toBe('Threads of Tradition');
    expect(l.levelBadge).toBe('INTERMEDIATE');
    expect(l.authoringLanguageTarget).toBe('TOEIC 550-780');
    expect(conversationalLessonErrors(l)).toEqual([]);
  }
});

test('all new lesson content, guides, pronunciation and feedback are English-only', () => {
  for (const l of lessons) {
    expect(l.supportLanguage).toBe('en');
    expect(l.goalTextJp).toBe('');
    expect(l.introductionData.introTexts.map((v: any) => v.language)).toEqual(['en']);
    expect(JSON.stringify(l)).not.toMatch(jp);
    expect(l.feedbackData.categories.every((c: any) => c.titleJp === '')).toBe(true);
    expect(l.learnData.steps[0].pronunciationPart).toBeUndefined();
  }
});

test('Step A has four complete relevant expression meanings and highlighted contextual examples, never six vocabulary cards', () => {
  const all = new Set<string>();
  for (const n of storyLessonNumbers) {
    const step = lesson(n).learnData.steps[0], expressions = traditionsEpisodes[n].expressions;
    expect(step.stepType).toBe('expressions');
    expect(step.stepName).toBe('STEP A: EXPRESSIONS');
    expect(step.vocabularyItems).toBeUndefined();
    expect(step.expressionItems).toHaveLength(4);
    step.expressionItems.forEach((item: any, i: number) => {
      const [phrase, meaning, example] = expressions[i]!;
      expect(item.definitionLine).toBe(`<strong>${phrase}</strong> ${meaning}`);
      expect(item.exampleSentence).toBe(`<em>${example}</em>`);
      expect(item.exampleSentence).toContain('<strong>');
      expect(plain(item.definitionLine).length).toBeGreaterThan(30);
      expect(plain(item.exampleSentence).length).toBeGreaterThan(30);
      expect(item.image).toBe('');
      all.add(phrase);
    });
  }
  expect(all.size).toBe(32);
});

test('standard guides introduce objective before situation and retain the fixed English rubric', () => {
  for (const l of lessons) {
    const learn = l.learnData.steps[0];
    expect(l.introductionData.lessonGoalSteps[0].script).toStartWith('Our lesson objective today is to');
    expect(l.introductionData.lessonGoalSteps[1].script).toStartWith('Here is our situation.');
    expect(l.introductionData.lessonGoalSteps).toHaveLength(4);
    expect(learn.tutorSteps).toHaveLength(5);
    expect(learn.discussionPart.tutorSteps).toHaveLength(5);
    expect(learn.pronunciationPart).toBeUndefined();
    expect(l.stepBData.stepType).toBe('pronunciation');
    expect(l.stepBData.pronunciation.phrases).toHaveLength(2);
    expect(l.stepBData.pronunciation.tutorSteps).toHaveLength(6);
    expect(l.applyData.tutorSteps).toHaveLength(2);
    expect(l.applyData.triviaTutorSteps).toHaveLength(4);
    expect(l.missionData.grammarTipItems).toHaveLength(5);
    expect(l.missionData2.topics).toHaveLength(3);
    expect(l.feedbackData.rubricTitle).toBe('LESSON OBJECTIVE ACHIEVEMENT');
    expect(l.feedbackData.rubricLevels.map((v: any) => v.score)).toEqual([4, 3, 2, 1]);
    expect(l.feedbackData.categories.map((v: any) => v.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    expect(l.feedbackData.tutorSteps).toHaveLength(6);
    expect(l.applyData.situationText).not.toMatch(/<[^>]+>/);
    expect(l.missionData.tutorSteps).toHaveLength(l.skill === 'speaking' ? 3 : 4);
  }
});

test('models fit the intermediate budgets, speaking stays tutor-first and roles are concrete', () => {
  const target = conversationalLanguageTarget(6)!;
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = traditionsEpisodes[n];
    expect(wordCount(e.intro)).toBeLessThanOrEqual(target.maxIntroWords);
    expect(wordCount(e.goal)).toBeLessThanOrEqual(15);
    const roleStep = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(roleStep.instruction).toContain('tutor speaks first');
    expect(roleStep.scripts[1].text).toBe(`1. ${e.mission.lines[0]}`);
    expect(l.missionData.situation).toMatch(/^You are (Aiko|Daniel|Mei)\./);
    const { storyData, ...facing } = l;
    expect(JSON.stringify(facing)).not.toMatch(/You may play|invented adult|No personal or romantic|\bmonologue\b/i);
    if (l.skill === 'speaking') {
      expect(l.applyData.dialogueLines).toHaveLength(10);
      l.applyData.dialogueLines.forEach((line: any, i: number) => expect(line.speaker).toBe(e.apply.roles![i % 2]));
      expect(wordCount(l.applyData.dialogueLines.map((v: any) => v.text).join(' '))).toBeLessThanOrEqual(target.maxDialogueWords);
    }
  }
});

test('listening scripts are distinct and tutor-only, not visible transcripts or full production instructions', () => {
  const l = lesson(2), a = l.applyData.tutorSteps[0].listeningScript, b = l.missionData.tutorSteps[1].listeningScript;
  expect(a).not.toBe(b);
  expect(wordCount(a)).toBeLessThanOrEqual(110);
  expect(wordCount(b)).toBeLessThanOrEqual(110);
  expect(a).toContain('introduces one part of the work');
  expect(b).toContain('not to finish a professional piece');
  expect(l.applyData.readingText).toBe('');
  expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.listeningScript).toBeUndefined();
  expect(l.missionData.readingPassage).toBeUndefined();
});

test('fresh reading evidence attributes customs and avoids inventing class details or delivery promises', () => {
  for (const n of [3, 8]) {
    const l = lesson(n), passage = l.missionData.readingPassage.blocks[0].content;
    expect(passage).not.toBe(l.applyData.readingText);
    expect(wordCount(passage)).toBeLessThanOrEqual(220);
    expect(wordCount(l.applyData.readingText)).toBeLessThanOrEqual(220);
  }
  const host = lesson(3).missionData.readingPassage.blocks[0].content;
  expect(host).toContain('tradition I teach');
  expect(host).toContain('wait for a suitable pause');
  expect(host).toContain('Respect does not require hiding discomfort');
  const handover = lesson(8).missionData.readingPassage.blocks[0].content;
  expect(handover).toContain('committee has agreed');
  expect(handover).toContain('does not give a new arrival time');
  expect(handover).toContain('not a paid booking');
  expect(handover).toContain('no class date, fee or place is confirmed');
});

test('all six/four exercise answers align with the visible choices and actual-error tracking is retained', () => {
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = traditionsEpisodes[n];
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.answers.map((v: any) => v.text)).toEqual(e.choose.map(v => v[1]));
    expect(l.exerciseData.stepBTutorSteps[1].answerKey.map((v: any) => v.text)).toEqual(e.choices.map((v, i) => `${i + 1}. ${v[3]} - ${v[v[3] === 'A' ? 1 : 2]}`));
    e.choose.forEach(([sentence, answer]) => expect(sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ') || []).toContain(answer));
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
  }
});

test('story keeps its new cast, staged agreement, unfinished documentary and open future arrangements', () => {
  for (const l of lessons) {
    expect(l.storyData.characters.map((v: any) => v.id)).toEqual(['aiko', 'haru', 'mei', 'daniel', 'takeda', 'nakamura']);
    expect(l.storyData.setting).toContain('Kanazawa');
    expect(JSON.stringify(l)).not.toMatch(/Eastbridge|Northstar|Kamo House|Mika Tanaka/);
  }
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(traditionsEpisodes[storyLessonNumbers[i - 1]!].closing);
  expect(traditionsEpisodes[1].mission.evidence).toContain('only an idea');
  expect(traditionsEpisodes[6].closing).toContain('committee agrees');
  expect(traditionsEpisodes[7].closing).toContain('not finished yet');
  expect(traditionsEpisodes[8].closing).toContain('details still need work');
  expect(traditionsEpisodes[9].closing).toContain('remain to be agreed');
});

test('English-only validation rejects three expressions, incomplete examples, Japanese fallback and vocabulary', () => {
  let l = structuredClone(lesson(1));
  l.learnData.steps[0].expressionItems.pop();
  expect(conversationalLessonErrors(l)).toContain('Level 6 Step A needs exactly four expressions instead of vocabulary.');
  l = structuredClone(lesson(1)); l.learnData.steps[0].expressionItems[0].exampleSentence = '';
  expect(conversationalLessonErrors(l)).toContain('Expression examples must contain complete items.');
  l = structuredClone(lesson(1)); l.applyData.situationTranslation = '日本語';
  expect(conversationalLessonErrors(l)).toContain('Level 6 content must be English-only.');
  l = structuredClone(lesson(1)); l.goalTextJp = 'A translated goal';
  expect(conversationalLessonErrors(l)).toContain('Level 6 must not include a translated goal.');
  l = structuredClone(lesson(1)); l.learnData.steps[0].vocabularyItems = [{ englishText: 'old card' }];
  expect(conversationalLessonErrors(l)).toContain('Level 6 Step A needs exactly four expressions instead of vocabulary.');
});

test('existing artwork, identity, publication state and fixed English feedback survive without caller mutation', () => {
  const previous = { id: 'keep-id', status: 'published', createdAt: 'keep-date', studentNotes: { text: 'keep-note', translation: 'Keep private note unchanged' }, backgroundImage: 'keep-header.webp',
    introductionData: { introImage: 'keep-intro.webp' }, learnData: { steps: [{ expressionItems: [{ image: 'keep-expression.webp' }] }] },
    applyData: { situationImage: 'keep-apply.webp' }, missionData: { image: 'keep-mission.webp', listeningScript: 'obsolete' },
    feedbackData: { ...lesson(1).feedbackData, categories: [{ title: 'KEEP', titleJp: '翻訳', examples: [{ youSaid: 'Keep this', correction: 'Keep that' }] }] } };
  const before = JSON.stringify(previous), l = buildTraditionsLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.createdAt).toBe('keep-date'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep-header.webp'); expect(l.introductionData.introImage).toBe('keep-intro.webp');
  expect(l.learnData.steps[0].expressionItems[0].image).toBe('keep-expression.webp');
  expect(l.applyData.situationImage).toBe('keep-apply.webp'); expect(l.missionData.image).toBe('keep-mission.webp');
  expect(l.feedbackData.categories).toEqual(clearConversationalTranslations(previous.feedbackData.categories));
  expect(l.missionData.listeningScript).toBeUndefined(); expect(JSON.stringify(previous)).toBe(before);
  for (const fresh of lessons) expect(JSON.stringify(fresh)).not.toMatch(/https?:\/\/[^" ]+\.(?:webp|png|jpe?g)/);
});

test('Level 6 checkpoints keep four source expressions and English-only support without calling a model', () => {
  const sources = [1, 2, 3, 4].map(n => ({ ...lesson(n), status: 'published' }));
  const evidence = summarizeCheckpointEvidence([], []), prompt = checkpointPrompt(sources, evidence);
  expect(prompt).toContain('TOEIC 550-780'); expect(prompt).toContain('exactly four relevant expressions');
  expect(prompt).toContain('Do not identify or invent student weaknesses');
  expect(prompt).toContain('catch up with someone'); expect(prompt).toContain('be mindful of something');
  const placeholders = addAvailableCheckpoints(sources);
  expect(placeholders.find(l => l.lessonNumber === 5)?.goalTextJp).toBe('');
  const content = { introduction: 'You are planning an event with a colleague.', introductionJp: '',
    stepA: [1, 2, 3, 4, 1, 2].map((sourceLessonNumber, i) => ({ sourceLessonNumber, sentence: `They was ready at ${i + 1}.`, answer: `They were ready at ${i + 1}.` })),
    stepB: [1, 2, 3, 4, 1].map((sourceLessonNumber, i) => ({ sourceLessonNumber, prompt: `Ask for help with task ${i + 1}.`, optionA: 'Could you help me, please?', optionB: 'I helped yesterday.', answer: 'A' as const })),
    challenge1: { situation: 'You are a volunteer. Your tutor is the organiser.', situationJp: '', instruction: 'Discuss a plan and a concern.', instructionJp: '', prompts: ['What could we offer?', 'How would it help?', 'What should we check first?'] },
    challenge2: { situation: 'Read the event note.', situationJp: '', title: 'Community event', passage: 'The workshop will be held in the community hall. Volunteers will explain the activity before visitors try it. The organiser will confirm the starting time later. Please do not announce an unconfirmed time.', questions: [{ question: 'Where is the workshop?', answer: 'In the community hall.' }, { question: 'What happens before the activity?', answer: 'An explanation.' }, { question: 'Is the starting time confirmed?', answer: 'No.' }] },
    challenge3: { situation: 'You are a volunteer. Your tutor is a visitor.', situationJp: '', instruction: 'Explain the confirmed details.', instructionJp: '', prompts: ['Where is it?', 'What happens first?', 'What time does it start?'] } };
  const validated = validateCheckpointContent(content, [1, 2, 3, 4], 6);
  const review = buildCheckpointLesson(checkpointSlot('conversational-skills-L6-C1-5-review')!, sources, validated);
  expect(review.learnData?.steps[0]?.stepType).toBe('expressions');
  expect(review.learnData?.steps[0]?.expressionItems).toHaveLength(4);
  expect(review.learnData?.steps[0]?.expressionItems?.map(v => v.definitionLine)).toEqual(sources.map(s => s.learnData.steps[0].expressionItems[0].definitionLine));
  expect(JSON.stringify(review)).not.toMatch(jp); expect(review.goalTextJp).toBe('');
  expect(review.stepBData?.stepType).toBe('pronunciation');
  expect(review.stepBData?.pronunciation?.phrases).toHaveLength(4);
  expect(review.stepBData?.pronunciation?.phrases.map(v => v.exampleSentence)).toEqual(sources.map(s => s.stepBData.pronunciation.phrases[0].exampleSentence));
  expect(() => validateCheckpointContent({ ...content, introductionJp: '日本語' }, [1, 2, 3, 4], 6)).toThrow('English-only');
  expect(() => validateCheckpointContent(content, [1, 2, 3, 4], 3)).toThrow('Translated checkpoint support');
});

test('offline source and guarded writer contain no model invocation or application key access', () => {
  const source = readFileSync(new URL('../content/conversational-skills/en/level-6-chapter-1/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
  const updater = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(updater).toContain("'6:1': { title: 'Keeping Traditions Alive'");
  expect(updater).toContain('Concurrent edit detected'); expect(updater).toContain('Full record read-back mismatch');
  expect(conversationalLanguageInstructions(6)).toContain('no Japanese translations');
});
