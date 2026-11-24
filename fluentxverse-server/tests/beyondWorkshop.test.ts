import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildBeyondWorkshopChapter, buildBeyondWorkshopLesson, beyondWorkshopEpisodes, beyondWorkshopId } from '../content/conversational-skills/en/level-6-chapter-2/build';
import { traditionsEpisodes } from '../content/conversational-skills/en/level-6-chapter-1/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';
import { clearConversationalTranslations, conversationalLanguageTarget } from '../../shared/conversationalLanguage';

const lessons: any[] = buildBeyondWorkshopChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);
const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

test('Beyond the Workshop continues Level 6 in eight draft story slots with the owner difficulty target', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const n of storyLessonNumbers) {
    const l = lesson(n);
    expect([l.id, l.level, l.chapter, l.status]).toEqual([beyondWorkshopId(n), 6, 2, 'draft']);
    expect(l.chapterName).toBe('Beyond the Workshop');
    expect(l.storyData.storyTitle).toBe('Threads of Tradition');
    expect(l.levelBadge).toBe('INTERMEDIATE');
    expect(l.authoringLanguageTarget).toBe('TOEIC 550-780');
    expect(conversationalLessonErrors(l)).toEqual([]);
  }
});

test('each English-only lesson has four contextual expressions and only Step B pronunciation, not vocabulary', () => {
  const expressions = new Set<string>();
  for (const n of storyLessonNumbers) {
    const l = lesson(n), step = l.learnData.steps[0];
    expect(l.supportLanguage).toBe('en');
    expect(l.goalTextJp).toBe('');
    expect(l.introductionData.introTexts.map((v: any) => v.language)).toEqual(['en']);
    expect(JSON.stringify(l)).not.toMatch(japanese);
    expect(step.stepType).toBe('expressions');
    expect(step.stepName).toBe('STEP A: EXPRESSIONS');
    expect(step.vocabularyItems).toBeUndefined();
    expect(step.expressionItems).toHaveLength(4);
    step.expressionItems.forEach((item: any, i: number) => {
      const [phrase, meaning, example] = beyondWorkshopEpisodes[n].expressions[i]!;
      expect(item.definitionLine).toBe(`<strong>${phrase}</strong> ${meaning}`);
      expect(item.exampleSentence).toBe(`<em>${example}</em>`);
      expect(example).toMatch(/<strong>[^<]+<\/strong>/);
      expect(meaning.length).toBeGreaterThan(30);
      expressions.add(phrase);
    });
    expect(step.pronunciationPart).toBeUndefined();
  }
  expect(expressions.size).toBe(32);
});

test('owner pointers keep objective first, plain situations, standard guides and concrete tutor-first roles', () => {
  const target = conversationalLanguageTarget(6)!;
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = beyondWorkshopEpisodes[n], learn = l.learnData.steps[0];
    expect(l.introductionData.lessonGoalSteps[0].script).toStartWith('Our lesson objective today is to');
    expect(l.introductionData.lessonGoalSteps[1].script).toBe(`Here is our situation. ${e.intro}`);
    expect(l.introductionData.lessonGoalSteps).toHaveLength(4);
    expect(l.applyData.situationText).not.toMatch(/<[^>]+>/);
    expect(l.applyData.situationTranslation).toBe('');
    expect(l.applyData.tutorSteps[1].questions).toEqual(e.apply.questions.map(([question, answer]) => ({ question, answer })));
    expect(learn.tutorSteps).toHaveLength(5);
    expect(learn.discussionPart.tutorSteps).toHaveLength(5);
    expect(l.stepBData.stepType).toBe('pronunciation');
    expect(l.stepBData.pronunciation.phrases).toHaveLength(2);
    expect(l.stepBData.pronunciation.tutorSteps).toHaveLength(6);
    expect(l.applyData.tutorSteps).toHaveLength(2);
    expect(l.applyData.triviaTutorSteps).toHaveLength(4);
    expect(l.missionData2.topics).toHaveLength(3);
    expect(l.missionData.grammarTipItems).toHaveLength(5);
    expect(l.feedbackData.tutorSteps).toHaveLength(6);
    expect(l.feedbackData.categories.map((c: any) => c.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    expect(l.feedbackData.rubricLevels.map((r: any) => r.score)).toEqual([4, 3, 2, 1]);
    expect(wordCount(e.intro)).toBeLessThanOrEqual(target.maxIntroWords);
    expect(wordCount(e.goal)).toBeLessThanOrEqual(15);
    expect(l.missionData.situation).toMatch(/^You are (Aiko|Haru|Daniel)\. Your tutor is /);
    const step = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(step.instruction).toContain('tutor speaks first');
    expect(step.scripts[0].text).toContain(`I'll be ${e.mission.roles[0]}. Please be ${e.mission.roles[1]}`);
    expect(step.scripts[1].text).toBe(`1. ${e.mission.lines[0]}`);
    expect(e.mission.lines[0]).not.toMatch(/Tell me one thing|What can you ask me|Explain the roleplay/i);
    if (l.skill === 'speaking') {
      expect(l.applyData.dialogueLines).toHaveLength(10);
      l.applyData.dialogueLines.forEach((line: any, i: number) => expect(line.speaker).toBe(e.apply.roles![i % 2]));
      expect(wordCount(e.apply.dialogue!.map(v => v[1]).join(' '))).toBeLessThanOrEqual(target.maxDialogueWords);
    }
  }
});

test('distinct short listening scripts remain tutor-only and papermaking stays supervised partial practice', () => {
  const l = lesson(2), a = l.applyData.tutorSteps[0].listeningScript, b = l.missionData.tutorSteps[1].listeningScript;
  expect(a).not.toBe(b);
  for (const script of [a, b]) expect(wordCount(script)).toBeLessThanOrEqual(110);
  expect(a).toContain('thirty years');
  expect(a).toContain('spread them out evenly');
  expect(a).toContain('not the whole production process');
  expect(b).toContain('one supervised part');
  expect(b).toContain('rather than only the joke');
  expect(l.applyData.readingText).toBe('');
  expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.listeningScript).toBeUndefined();
  expect(l.missionData.readingPassage).toBeUndefined();
});

test('fresh reading challenges supply visible evidence and respect Yui’s independent choice', () => {
  for (const n of [3, 8]) {
    const l = lesson(n), text = l.missionData.readingPassage.blocks[0].content;
    expect(text).not.toBe(l.applyData.readingText);
    expect(wordCount(text)).toBeLessThanOrEqual(220);
    expect(wordCount(l.applyData.readingText)).toBeLessThanOrEqual(220);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  const text = lesson(3).missionData.readingPassage.blocks[0].content;
  expect(text).toContain('Yui agreed');
  expect(text).toContain('she admires her mother');
  expect(text).toContain('choose her own path');
  expect(text).toContain('not a launched service');
  expect(text).toContain('not promised to become a full-time artisan');
  expect(text).toContain('ask whether the selected words still express what she meant');
});

test('the misleading title and missing interview context require revision, not automatic approval', () => {
  const apply = lesson(8).applyData.readingText;
  expect(apply).toContain('Japan’s Last Artisans');
  expect(apply).toContain('Hands of the Future');
  expect(apply).toContain('helping through technology has been removed');
  const text = lesson(8).missionData.readingPassage.blocks[0].content;
  expect(text).toContain('title alone does not prove');
  expect(text).toContain('ask participants to review sensitive sections');
  expect(text).toContain('not confirmation that every participant has already approved');
  expect(text).toContain('different perspectives');
});

test('price comparison, tools and communal dance retain qualified perspectives', () => {
  expect(beyondWorkshopEpisodes[4].apply.dialogue![6]![1]).toContain('Machines are useful');
  expect(beyondWorkshopEpisodes[4].mission.evidence).toContain('Do not claim all Japanese woodwork uses no nails');
  expect(beyondWorkshopEpisodes[4].closing).not.toContain('Mei agrees');
  expect(beyondWorkshopEpisodes[6].intro).toContain('five times');
  expect(beyondWorkshopEpisodes[6].mission.evidence).toContain('only to the fictional pair');
  expect(beyondWorkshopEpisodes[6].apply.dialogue![3]![1]).toContain('out of someone’s price range');
  expect(beyondWorkshopEpisodes[7].intro).toContain('all four enter the dance circle');
  expect(beyondWorkshopEpisodes[7].apply.dialogue![5]![1]).toContain('For her');
  expect(beyondWorkshopEpisodes[7].apply.dialogue![9]![1]).toContain('without speaking for everyone');
});

test('exercise keys match the six/four rendered options and observed-error tracking remains', () => {
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = beyondWorkshopEpisodes[n];
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.answers.map((v: any) => v.text)).toEqual(e.choose.map(v => v[1]));
    expect(l.exerciseData.tutorSteps[0].answerKey.map((v: any) => v.text)).toEqual(e.choose.map((v, i) => `${i + 1}. ${v[1]}`));
    expect(l.exerciseData.stepBTutorSteps[1].answerKey.map((v: any) => v.text)).toEqual(e.choices.map((v, i) => `${i + 1}. ${v[3]} - ${v[v[3] === 'A' ? 1 : 2]}`));
    e.choose.forEach(([sentence, answer]) => expect(sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ') || []).toContain(answer));
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
  }
});

test('continuity keeps the festival, route, new screening and open future without inherited plots or romance', () => {
  expect(lesson(1).storyData.previousSummary).toBe(traditionsEpisodes[9].closing);
  expect(beyondWorkshopEpisodes[1].intro).toContain('Two weeks after');
  expect(beyondWorkshopEpisodes[1].intro).toContain('start in Fukui, then travel to Gifu');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(beyondWorkshopEpisodes[storyLessonNumbers[i - 1]!].closing);
  expect(beyondWorkshopEpisodes[9].intro).toContain('Several weeks later');
  expect(beyondWorkshopEpisodes[9].apply.dialogue![1]![1]).toContain('at least for one viewer');
  expect(beyondWorkshopEpisodes[9].apply.dialogue![7]![1]).toContain('not agreed on a new trip');
  for (const l of lessons) {
    expect(l.storyData.characters.map((c: any) => c.id)).toEqual(['aiko', 'haru', 'mei', 'daniel', 'takeda', 'fujita', 'yui', 'mori']);
    expect(JSON.stringify(l)).not.toMatch(/Eastbridge|Northstar|Kamo House|Mika Tanaka/);
    const { storyData, ...facing } = l;
    expect(JSON.stringify(facing)).not.toMatch(/You may play|invented adult|No personal or romantic|\bmonologue\b|boyfriend|girlfriend|\bdating\b/i);
  }
});

test('caller identity, artwork, publication state, learner properties and fixed English feedback survive', () => {
  const previous = { id: 'keep-id', status: 'published', createdAt: 'keep-date', studentNotes: { text: 'keep-note', translation: 'Keep private note unchanged' },
    backgroundImage: 'keep-header.webp', introductionData: { introImage: 'keep-intro.webp' },
    learnData: { steps: [{ expressionItems: [{ image: 'keep-expression.webp' }] }] },
    applyData: { situationImage: 'keep-apply.webp' }, missionData: { image: 'keep-mission.webp', listeningScript: 'obsolete' },
    feedbackData: { ...lesson(1).feedbackData, categories: [{ title: 'KEEP', titleJp: '翻訳', examples: [{ youSaid: 'Keep this', correction: 'Keep that' }] }] } };
  const copy = JSON.stringify(previous), l = buildBeyondWorkshopLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.createdAt).toBe('keep-date'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep-header.webp'); expect(l.introductionData.introImage).toBe('keep-intro.webp');
  expect(l.learnData.steps[0].expressionItems[0].image).toBe('keep-expression.webp');
  expect(l.applyData.situationImage).toBe('keep-apply.webp'); expect(l.missionData.image).toBe('keep-mission.webp');
  expect(l.feedbackData.categories).toEqual(clearConversationalTranslations(previous.feedbackData.categories));
  expect(l.missionData.listeningScript).toBeUndefined(); expect(l.missionData.readingPassage).toBeUndefined();
  expect(JSON.stringify(previous)).toBe(copy);
  for (const fresh of lessons) expect(JSON.stringify(fresh)).not.toMatch(/https?:\/\/[^" ]+\.(?:webp|png|jpe?g)/);
});

test('only dynamic checkpoints fill 5/10; authoring stays offline and persistence is guarded', () => {
  const withReviews = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  const reviews = withReviews.filter(l => [5, 10].includes(l.lessonNumber));
  expect(reviews.map(l => l.id)).toEqual(['conversational-skills-L6-C2-5-review', 'conversational-skills-L6-C2-10-review']);
  expect(reviews.every(l => !l.goalTextJp)).toBe(true);
  const source = readFileSync(new URL('../content/conversational-skills/en/level-6-chapter-2/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'6:2': { title: 'Beyond the Workshop'");
  expect(writer).toContain('Concurrent edit detected');
  expect(writer).toContain('Full record read-back mismatch');
});
