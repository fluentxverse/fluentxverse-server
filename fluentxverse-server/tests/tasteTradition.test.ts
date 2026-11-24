import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildTasteTraditionChapter, buildTasteTraditionLesson, tasteTraditionEpisodes, tasteTraditionId } from '../content/conversational-skills/en/level-6-chapter-3/build';
import { beyondWorkshopEpisodes } from '../content/conversational-skills/en/level-6-chapter-2/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildTasteTraditionChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);

test('The Taste of Tradition uses eight English-only drafts, agreed skills and TOEIC 550-780 wording', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = tasteTraditionEpisodes[n];
    expect([l.id, l.level, l.chapter, l.status]).toEqual([tasteTraditionId(n), 6, 3, 'draft']);
    expect(l.chapterName).toBe('The Taste of Tradition');
    expect(l.storyData.storyTitle).toBe('Threads of Tradition');
    expect(l.authoringLanguageTarget).toBe('TOEIC 550-780');
    expect(l.supportLanguage).toBe('en'); expect(l.goalTextJp).toBe('');
    expect(JSON.stringify(l)).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(l.introductionData.introTexts.map((v: any) => v.language)).toEqual(['en']);
    expect(wordCount(e.intro)).toBeLessThanOrEqual(90);
    expect(wordCount(e.goal)).toBeLessThanOrEqual(15);
    expect(conversationalLessonErrors(l)).toEqual([]);
  }
});

test('four expressions per lesson have meanings, highlighted examples and the standard tutor guides', () => {
  const unique = new Set<string>();
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = tasteTraditionEpisodes[n], step = l.learnData.steps[0];
    expect(step.stepType).toBe('expressions'); expect(step.stepName).toBe('STEP A: EXPRESSIONS');
    expect(step.vocabularyItems).toBeUndefined(); expect(step.expressionItems).toHaveLength(4);
    step.expressionItems.forEach((item: any, i: number) => {
      const [phrase, meaning, example] = e.expressions[i]!;
      expect(item.definitionLine).toBe(`<strong>${phrase}</strong> ${meaning}`);
      expect(item.exampleSentence).toBe(`<em>${example}</em>`); expect(example).toContain('<strong>');
      unique.add(phrase);
    });
    for (const part of [step, step.discussionPart]) expect(part.tutorSteps).toHaveLength(5);
    expect(l.introductionData.lessonGoalSteps).toHaveLength(4);
    expect(l.introductionData.lessonGoalSteps[0].script).toStartWith('Our lesson objective today is to');
    expect(l.introductionData.lessonGoalSteps[1].script).toBe(`Here is our situation. ${e.intro}`);
    expect(l.applyData.situationText).not.toMatch(/<[^>]+>/);
    expect(l.applyData.tutorSteps[1].questions).toEqual(e.apply.questions.map(([question, answer]) => ({ question, answer })));
    expect(l.applyData.triviaTutorSteps).toHaveLength(4); expect(l.missionData.grammarTipItems).toHaveLength(5);
    expect(l.missionData2.topics).toHaveLength(3); expect(l.feedbackData.tutorSteps).toHaveLength(6);
    expect(l.feedbackData.categories.map((c: any) => c.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    expect(l.feedbackData.rubricLevels.map((r: any) => r.score)).toEqual([4, 3, 2, 1]);
  }
  expect(unique.size).toBe(32);
});

test('Step B teaches natural linking and meaning groups with exact bold stress, not a bold whole sentence', () => {
  for (const l of lessons) {
    const p = l.stepBData.pronunciation;
    expect(l.stepBData.stepType).toBe('pronunciation'); expect(l.stepBData.grammarTip).toBeUndefined();
    expect(p.phrases).toHaveLength(2); expect(p.tutorSteps).toHaveLength(6);
    expect(p.tip).toContain('Bold marks the stressed');
    for (const item of p.phrases) {
      expect(item.pronunciationGuide).toMatch(/^\/ .+ \/$/);
      expect(item.pronunciationGuide).toMatch(/[‿|]/);
      const bold = [...item.exampleSentence.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m: any) => m[1]);
      expect(bold.length).toBeGreaterThan(0);
      expect(bold.join('')).not.toMatch(/[‿|]/);
      expect(bold.join('').length).toBeLessThan(item.exampleSentence.replace(/<[^>]+>/g, '').length);
    }
    expect(l.learnData.steps[0].pronunciationPart).toBeUndefined();
    expect(l.learnData.steps[0].discussionPart.tutorSteps.at(-1).script).toContain('Step B Pronunciation');
  }
});

test('speaking models are short alternating tutor-first dialogue with direct roles and natural openings', () => {
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = tasteTraditionEpisodes[n];
    const guide = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(guide.instruction).toContain('tutor speaks first');
    expect(guide.scripts[1].text).toBe(`1. ${e.mission.lines[0]}`);
    expect(l.missionData.situation).toMatch(/^You are (Mei|Haru|Daniel)\. Your tutor is /);
    if (l.skill === 'speaking') {
      expect(l.applyData.dialogueLines).toHaveLength(10);
      l.applyData.dialogueLines.forEach((line: any, i: number) => expect(line.speaker).toBe(e.apply.roles![i % 2]));
      expect(wordCount(e.apply.dialogue!.map(v => v[1]).join(' '))).toBeLessThanOrEqual(180);
    }
  }
  expect(lesson(4).applyData.tutorSteps[0].scripts[0].text).toContain('the brewery guide');
  expect(lesson(4).missionData.tutorSteps[1].scripts[0].text).toContain('Please be Haru');
});

test('listening stays short, distinct and tutor-only without inventing a universal menu or price', () => {
  const l = lesson(2), a = l.applyData.tutorSteps[0].listeningScript, b = l.missionData.tutorSteps[1].listeningScript;
  expect(a).not.toBe(b); for (const s of [a, b]) expect(wordCount(s)).toBeLessThanOrEqual(110);
  expect(a).toContain('in season'); expect(a).toContain('Haru’s grandmother');
  expect(b).toContain('another visitor may remember something different');
  expect(b).toContain('does not give a rule for all restaurants');
  expect(l.applyData.readingText).toBe(''); expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.listeningScript).toBeUndefined(); expect(l.missionData.readingPassage).toBeUndefined();
});

test('reading challenges have fresh visible evidence and keep producer methods and event permissions distinct', () => {
  for (const n of [3, 8]) {
    const l = lesson(n), text = l.missionData.readingPassage.blocks[0].content;
    expect(text).not.toBe(l.applyData.readingText);
    expect(wordCount(text)).toBeLessThanOrEqual(220); expect(wordCount(l.applyData.readingText)).toBeLessThanOrEqual(220);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  const research = lesson(3).missionData.readingPassage.blocks[0].content;
  expect(research).toContain('does not automatically mean'); expect(research).toContain('one timetable');
  expect(research).toContain('not a confirmed training programme');
  const visitors = lesson(8).missionData.readingPassage.blocks[0].content;
  expect(visitors).toContain('organisers have approved');
  expect(visitors).toContain('not her grandmother’s cooking instructions');
  expect(visitors).toContain('No public lesson or date has been agreed');
});

test('refusal is accepted and the granddaughter’s learning is a real private route for preservation', () => {
  const e = tasteTraditionEpisodes[6];
  expect(e.apply.dialogue![2]![1]).toContain('keep it within the family');
  expect(e.apply.dialogue![6]![1]).toContain('My granddaughter is learning it');
  expect(e.apply.dialogue![8]![1]).toContain('share those');
  expect(e.mission.evidence).toContain('The refusal stands');
  expect(e.mission.evidence).toContain('Do not persuade');
  expect(e.closing).toContain('The boundary remains in place');
});

test('Mei’s decision precedes organisers’ agreement and possible future teaching never becomes a promise', () => {
  expect(tasteTraditionEpisodes[7].intro).toContain('have not yet accepted');
  expect(tasteTraditionEpisodes[7].closing).toContain('still need to consider');
  expect(tasteTraditionEpisodes[8].apply.text).toContain('The organisers agree');
  expect(tasteTraditionEpisodes[8].apply.text).toContain('Perhaps one day');
  expect(tasteTraditionEpisodes[8].mission.evidence).toContain('No private instructions');
});

test('final recipe is a separate voluntary creation with limited sharing, not the private recipe or a disclosure reward', () => {
  const e = tasteTraditionEpisodes[9];
  expect(e.apply.dialogue![2]![1]).toContain('I developed it myself');
  expect(e.apply.dialogue![4]![1]).toContain('That family recipe stays private');
  expect(e.apply.dialogue![4]![1]).toContain('students and visitors');
  expect(e.mission.evidence).toContain('Respect is not portrayed as a tactic');
  expect(e.mission.evidence).toContain('Do not invent its ingredients');
  expect(e.closing).toContain('Mei’s restaurant'); expect(e.closing).toContain('cleaning');
});

test('all six/four rendered exercise keys agree with the options and actual-error tracking remains', () => {
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = tasteTraditionEpisodes[n];
    expect(l.exerciseData.chooseItems).toHaveLength(6); expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.answers.map((v: any) => v.text)).toEqual(e.choose.map(v => v[1]));
    expect(l.exerciseData.stepBTutorSteps[1].answerKey.map((v: any) => v.text)).toEqual(e.choices.map((v, i) => `${i + 1}. ${v[3]} - ${v[v[3] === 'A' ? 1 : 2]}`));
    e.choose.forEach(([sentence, answer]) => expect(sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ') || []).toContain(answer));
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
  }
});

test('continuity preserves the independent cast, prior screening and warm friendship ending', () => {
  expect(lesson(1).storyData.previousSummary).toBe(beyondWorkshopEpisodes[9].closing);
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(tasteTraditionEpisodes[storyLessonNumbers[i - 1]!].closing);
  for (const l of lessons) {
    expect(l.storyData.characters.map((c: any) => c.id)).toEqual(['mei', 'aiko', 'haru', 'daniel', 'ishida', 'guide', 'okabe']);
    expect(JSON.stringify(l)).not.toMatch(/Eastbridge|Northstar|Kamo House|Mika Tanaka/);
    const { storyData, ...facing } = l;
    expect(JSON.stringify(facing)).not.toMatch(/You may play|invented adult|No personal or romantic|\bmonologue\b|boyfriend|girlfriend|\bdating\b/i);
  }
});

test('identity, artwork, status, fixed feedback and learner properties survive; only dynamic checkpoints fill 5/10', () => {
  const previous = { id: 'keep-id', status: 'published', backgroundImage: 'keep.webp', studentNotes: { text: 'keep' },
    introductionData: { introImage: 'keep-intro.webp' }, applyData: { situationImage: 'keep-apply.webp' },
    missionData: { image: 'keep-mission.webp', listeningScript: 'obsolete' }, feedbackData: { ...lesson(1).feedbackData, categories: [{ title: 'KEEP' }] } };
  const copy = JSON.stringify(previous), l = buildTasteTraditionLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep.webp'); expect(l.introductionData.introImage).toBe('keep-intro.webp');
  expect(l.applyData.situationImage).toBe('keep-apply.webp'); expect(l.missionData.image).toBe('keep-mission.webp');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]); expect(JSON.stringify(previous)).toBe(copy);
  expect(l.missionData.listeningScript).toBeUndefined(); expect(l.missionData.readingPassage).toBeUndefined();
  const reviews = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' }))).filter(l => [5, 10].includes(l.lessonNumber));
  expect(reviews.map(l => l.id)).toEqual(['conversational-skills-L6-C3-5-review', 'conversational-skills-L6-C3-10-review']);
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'6:3': { title: 'The Taste of Tradition'");
  expect(writer).toContain('Concurrent edit detected'); expect(writer).toContain('Full record read-back mismatch');
});
