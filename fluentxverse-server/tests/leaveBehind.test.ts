import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildLeaveBehindChapter, buildLeaveBehindLesson, leaveBehindEpisodes, leaveBehindId } from '../content/conversational-skills/en/level-6-chapter-5/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildLeaveBehindChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);

test('What We Leave Behind has eight English-only Level 6 Chapter 5 drafts in the agreed slots and skills', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = leaveBehindEpisodes[n];
    expect([l.id, l.level, l.chapter, l.status]).toEqual([leaveBehindId(n), 6, 5, 'draft']);
    expect(l.chapterName).toBe('What We Leave Behind'); expect(l.storyData.storyTitle).toBe('Threads of Tradition');
    expect(l.authoringLanguageTarget).toBe('TOEIC 550-780'); expect(l.supportLanguage).toBe('en');
    expect(l.goalTextJp).toBe(''); expect(l.introductionData.introTexts.map((v: any) => v.language)).toEqual(['en']);
    expect(JSON.stringify(l)).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(wordCount(e.intro)).toBeLessThanOrEqual(90); expect(wordCount(e.goal)).toBeLessThanOrEqual(15);
    expect(conversationalLessonErrors(l)).toEqual([]);
  }
});

test('owner pointers keep four expressions, objective first, plain situations, separate questions and standard guides', () => {
  const phrases = new Set<string>();
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = leaveBehindEpisodes[n], step = l.learnData.steps[0];
    expect(step.stepType).toBe('expressions'); expect(step.stepName).toBe('STEP A: EXPRESSIONS');
    expect(step.vocabularyItems).toBeUndefined(); expect(step.expressionItems).toHaveLength(4);
    step.expressionItems.forEach((item: any, i: number) => {
      const [phrase, meaning, example] = e.expressions[i]!;
      expect(item.definitionLine).toBe(`<strong>${phrase}</strong> ${meaning}`);
      expect(item.exampleSentence).toBe(`<em>${example}</em>`); expect(example).toContain('<strong>'); phrases.add(phrase);
    });
    expect(step.tutorSteps).toHaveLength(5); expect(step.discussionPart.tutorSteps).toHaveLength(5);
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
  expect(phrases.size).toBe(32);
});

test('pronunciation exists only in Step B with connected phrases, precise bold stress and no unwanted commentary', () => {
  for (const l of lessons) {
    const step = l.learnData.steps[0], p = l.stepBData.pronunciation;
    expect(step.pronunciationPart).toBeUndefined();
    expect(step.discussionPart.tutorSteps.at(-1).script).toContain('Step B Pronunciation');
    expect(l.stepBData.stepType).toBe('pronunciation'); expect(l.stepBData.grammarTip).toBeUndefined();
    expect(p.phrases).toHaveLength(2); expect(p.tutorSteps).toHaveLength(6);
    expect(JSON.stringify([l.learnData, l.stepBData])).not.toMatch(/Part III|reading cues|\bIPA\b|accents?/i);
    for (const item of p.phrases) {
      expect(item.pronunciationGuide).toMatch(/^\/ .+ \/$/);
      const bold = [...item.exampleSentence.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m: any) => m[1]);
      expect(bold.length).toBeGreaterThan(0); expect(bold.join('')).not.toMatch(/[|‿]/);
      expect(bold.join('').length).toBeLessThan(item.exampleSentence.replace(/<[^>]+>/g, '').length);
    }
  }
});

test('dialogues stay short, alternating and tutor-first, including a concrete final beginner role', () => {
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = leaveBehindEpisodes[n];
    const guide = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(guide.instruction).toContain('tutor speaks first'); expect(guide.scripts[1].text).toBe(`1. ${e.mission.lines[0]}`);
    expect(l.missionData.situation).toMatch(/^You are Haru\. Your tutor is /);
    if (l.skill === 'speaking') {
      expect(l.applyData.dialogueLines).toHaveLength(10);
      l.applyData.dialogueLines.forEach((line: any, i: number) => expect(line.speaker).toBe(e.apply.roles![i % 2]));
      expect(wordCount(e.apply.dialogue!.map(v => v[1]).join(' '))).toBeLessThanOrEqual(180);
    }
  }
  expect(lesson(9).missionData.tutorSteps[1].scripts[0].text).toContain('a new student. Please be Haru');
  expect(leaveBehindEpisodes[9].mission.lines[0]).toContain('beginner’s workshop');
});

test('short distinct listening messages remain tutor-only and separate a possible role division from commitments', () => {
  const l = lesson(2), a = l.applyData.tutorSteps[0].listeningScript, b = l.missionData.tutorSteps[1].listeningScript;
  expect(a).not.toBe(b); for (const script of [a, b]) expect(wordCount(script)).toBeLessThanOrEqual(110);
  expect(a).toContain('eventually close'); expect(a).toContain('not an agreement yet');
  expect(b).toContain('No one has agreed to a teaching role yet');
  expect(l.applyData.readingText).toBe(''); expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.listeningScript).toBeUndefined(); expect(l.missionData.readingPassage).toBeUndefined();
});

test('reading missions have fresh visible evidence with a precise age correction and limited recording permission', () => {
  for (const n of [3, 8]) {
    const l = lesson(n), text = l.missionData.readingPassage.blocks[0].content;
    expect(text).not.toBe(l.applyData.readingText); expect(wordCount(text)).toBeLessThanOrEqual(220);
    expect(wordCount(l.applyData.readingText)).toBeLessThanOrEqual(220);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  const caption = lesson(3).missionData.readingPassage.blocks[0].content;
  expect(caption).toContain('Use nineteen'); expect(caption).toContain('does not supply a calendar year');
  expect(caption).toContain('not an agreement from every person for every future use');
  expect(caption).toContain('her recollections');
});

test('voluntary succession, year-end full-time retirement and occasional mentoring stay distinct', () => {
  expect(leaveBehindEpisodes[1].apply.dialogue![0]![1]).toContain('end of the year');
  expect(leaveBehindEpisodes[1].apply.dialogue![2]![1]).toContain('do not want you to feel obliged');
  expect(leaveBehindEpisodes[4].apply.dialogue![7]![1]).toContain('Expand only if');
  const response = lesson(8).missionData.readingPassage.blocks[0].content;
  expect(response).toContain('full-time master-artisan role'); expect(response).toContain('occasional mentor');
  expect(leaveBehindEpisodes[8].mission.evidence).toContain('not necessarily on this autumn afternoon');
});

test('trial plan keeps fair instructor pay, limited duration, shared responsibilities and unconfirmed results', () => {
  const e = leaveBehindEpisodes[6];
  expect(e.apply.dialogue![0]![1]).toContain('materials, maintenance and instructor payments');
  expect(e.apply.dialogue![3]![1]).toContain('income side');
  expect(e.apply.dialogue![4]![1]).toContain('six-month trial run');
  expect(e.apply.dialogue![5]![1]).toContain('coordinate daily operations and continue developing my own skills');
  expect(e.apply.dialogue![6]![1]).toContain('occasional mentor');
  expect(e.mission.evidence).toContain('No monetary amounts'); expect(e.mission.evidence).toContain('not completed bookings');
});

test('exhibition revision recognises the community and beginner interest is not a confirmed booking', () => {
  expect(leaveBehindEpisodes[7].intro).toContain('Two days before opening');
  expect(leaveBehindEpisodes[7].closing).toContain('Mrs. Takeda approves');
  expect(leaveBehindEpisodes[7].closing).toContain('former apprentices, colleagues and craftspeople');
  const response = lesson(8).missionData.readingPassage.blocks[0].content;
  expect(response).toContain('not been supplied'); expect(response).toContain('completed booking');
  expect(leaveBehindEpisodes[8].mission.evidence).toContain('short conversational appreciation');
});

test('ending confirms school visits and teachers but begins the trial, closes every friend’s arc and has no sequel', () => {
  const e = leaveBehindEpisodes[9];
  expect(e.intro).toContain('Schools have scheduled visits'); expect(e.intro).toContain('artisans have agreed to teach');
  expect(e.intro).toContain('first student group'); expect(e.intro).toContain('programme remains small');
  expect(e.closing).toContain('Aiko, Mei and Daniel'); expect(e.closing).toContain('education, food stories shared with families’ agreement and a completed documentary series');
  expect(e.closing).toContain('puts down his camera'); expect(e.closing).toContain('The End');
  expect(e.mission.evidence).toContain('not completed or profitable by proof');
  expect(lesson(1).storyData.previousSummary).toContain('rural community');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(leaveBehindEpisodes[storyLessonNumbers[i - 1]!].closing);
  for (const l of lessons) {
    const { storyData, ...facing } = l;
    expect(storyData.characters.map((c: any) => c.id)).toEqual(['haru', 'takeda', 'aiko', 'mei', 'daniel']);
    expect(JSON.stringify(facing)).not.toMatch(/You may play|invented adult|No personal or romantic|\bmonologue\b|boyfriend|girlfriend|\bdating\b|Kamo House|Eastbridge/);
  }
});

test('six/four exercise keys align with the rendered choices and observed-error support remains', () => {
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = leaveBehindEpisodes[n];
    expect(l.exerciseData.chooseItems).toHaveLength(6); expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.answers.map((v: any) => v.text)).toEqual(e.choose.map(v => v[1]));
    expect(l.exerciseData.stepBTutorSteps[1].answerKey.map((v: any) => v.text)).toEqual(e.choices.map((v, i) => `${i + 1}. ${v[3]} - ${v[v[3] === 'A' ? 1 : 2]}`));
    e.choose.forEach(([sentence, answer]) => expect(sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ') || []).toContain(answer));
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
  }
});

test('identity, artwork, status and feedback are preserved; checkpoints remain dynamic and authoring offline', () => {
  const previous = { id: 'keep-id', status: 'published', backgroundImage: 'keep.webp', studentNotes: { text: 'keep' },
    introductionData: { introImage: 'keep-intro.webp' }, applyData: { situationImage: 'keep-apply.webp' },
    missionData: { image: 'keep-mission.webp', listeningScript: 'obsolete' }, feedbackData: { ...lesson(1).feedbackData, categories: [{ title: 'KEEP' }] } };
  const copy = JSON.stringify(previous), l = buildLeaveBehindLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep.webp'); expect(l.introductionData.introImage).toBe('keep-intro.webp');
  expect(l.applyData.situationImage).toBe('keep-apply.webp'); expect(l.missionData.image).toBe('keep-mission.webp');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]); expect(JSON.stringify(previous)).toBe(copy);
  expect(l.missionData.listeningScript).toBeUndefined(); expect(l.missionData.readingPassage).toBeUndefined();
  const reviews = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' }))).filter(l => [5, 10].includes(l.lessonNumber));
  expect(reviews.map(l => l.id)).toEqual(['conversational-skills-L6-C5-5-review', 'conversational-skills-L6-C5-10-review']);
  const source = readFileSync(new URL('../content/conversational-skills/en/level-6-chapter-5/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'6:5': { title: 'What We Leave Behind'"); expect(writer).not.toContain("'6:4':");
  expect(writer).toContain('Concurrent edit detected'); expect(writer).toContain('Full record read-back mismatch');
});
