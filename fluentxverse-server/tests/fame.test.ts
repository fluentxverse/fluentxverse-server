import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fameEpisodes, fameId, buildFameChapter, buildFameLesson } from '../content/conversational-skills/en/level-7-chapter-4/build';
import { contractEpisodes } from '../content/conversational-skills/en/level-7-chapter-3/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints, checkpointPrompt, summarizeCheckpointEvidence } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildFameChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);

test('The Price of Fame uses the confirmed Level 7 range and current expression/guide pointers', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  const phrases = new Set<string>();
  for (const n of storyLessonNumbers) {
    const e = fameEpisodes[n], l = lesson(n), step = l.learnData.steps[0];
    expect([l.id, l.level, l.chapter, l.status]).toEqual([fameId(n), 7, 4, 'draft']);
    expect(l.chapterName).toBe('The Price of Fame'); expect(l.storyData.storyTitle).toBe('Beyond the Spotlight');
    expect(l.authoringLanguageTarget).toBe('TOEIC 550-780'); expect(l.supportLanguage).toBe('en'); expect(l.goalTextJp).toBe('');
    expect(JSON.stringify(l)).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(conversationalLessonErrors(l)).toEqual([]);
    expect(step.stepName).toBe('STEP A: EXPRESSIONS'); expect(step.stepType).toBe('expressions');
    expect(step.vocabularyItems).toBeUndefined(); expect(step.expressionItems).toHaveLength(4);
    step.expressionItems.forEach((item: any, i: number) => {
      const [phrase, meaning, example] = e.expressions[i]!; phrases.add(phrase);
      expect(item.definitionLine).toBe(`<strong>${phrase}</strong> ${meaning}`);
      expect(item.exampleSentence).toBe(`<em>${example}</em>`); expect(example).toContain('<strong>');
    });
    expect(l.introductionData.lessonGoalSteps[0].script).toStartWith('Our lesson objective today is to');
    expect(l.introductionData.lessonGoalSteps[1].script).toBe(`Here is our situation. ${e.intro}`);
    expect(l.applyData.situationText).not.toMatch(/<[^>]*>/);
    expect(l.applyData.tutorSteps[1].questions).toEqual(e.apply.questions.map(([question, answer]) => ({ question, answer })));
    expect(step.tutorSteps).toHaveLength(5); expect(step.discussionPart.tutorSteps).toHaveLength(5);
    expect(l.applyData.triviaTutorSteps).toHaveLength(4); expect(l.missionData.grammarTipItems).toHaveLength(5);
    expect(l.missionData2.topics).toHaveLength(3); expect(l.feedbackData.tutorSteps).toHaveLength(6);
    expect(l.feedbackData.categories.map((c: any) => c.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
  }
  expect(phrases.size).toBe(32);
});

test('only Step B contains pronunciation, with two connected phrases and exact partial bold stress', () => {
  for (const l of lessons) {
    const step = l.learnData.steps[0], p = l.stepBData.pronunciation;
    expect(step.pronunciationPart).toBeUndefined(); expect(l.stepBData.stepType).toBe('pronunciation');
    expect(step.discussionPart.tutorSteps.at(-1).script).toContain('Step B Pronunciation');
    expect(p.phrases).toHaveLength(2); expect(p.tutorSteps).toHaveLength(6);
    expect(JSON.stringify([l.learnData, l.stepBData])).not.toMatch(/Part III|reading cues|\bIPA\b|accents?/i);
    for (const item of p.phrases) {
      expect(item.pronunciationGuide).toMatch(/^\/ .+[|‿].+ \/$/);
      const bold = [...item.exampleSentence.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m: any) => m[1]);
      expect(bold.length).toBeGreaterThan(0); expect(bold.join('')).not.toMatch(/[|‿]/);
      expect(bold.join('').length).toBeLessThan(item.exampleSentence.replace(/<[^>]*>/g, '').length);
    }
  }
});

test('short tutor-first models, private listening and fresh reading notes fit the language budgets', () => {
  for (const n of storyLessonNumbers) {
    const e = fameEpisodes[n], l = lesson(n), guide = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(wordCount(e.goal)).toBeLessThanOrEqual(15); expect(wordCount(e.intro)).toBeLessThanOrEqual(90);
    expect(l.missionData.situation).toMatch(/^You are (Natsumi|Kai|Maya|Jisoo)\. Your tutor is /);
    expect(guide.instruction).toContain('tutor speaks first');
    expect(guide.scripts[0].text).toContain(`I'll be ${e.mission.roles[0]}. Please be ${e.mission.roles[1]}`);
    expect(guide.scripts[1].text).toBe(`1. ${e.mission.lines[0]}`);
    expect(e.mission.lines[0]).not.toMatch(/asks:|Tell me one thing|What can you ask/);
    if (e.skill === 'speaking') {
      expect(l.applyData.dialogueLines).toHaveLength(10);
      e.apply.dialogue!.forEach(([speaker], i) => expect(speaker).toBe(e.apply.roles![i % 2]!));
      expect(wordCount(e.apply.dialogue!.map(v => v[1]).join(' '))).toBeLessThanOrEqual(180);
    } else {
      expect(e.apply.text).not.toBe(e.mission.text);
      for (const text of [e.apply.text!, e.mission.text!]) expect(wordCount(text)).toBeLessThanOrEqual(e.skill === 'listening' ? 110 : 220);
      expect(l.applyData.dialogueLines).toEqual([]);
      if (e.skill === 'listening') {
        expect(l.applyData.readingText).toBe(''); expect(l.missionData.readingPassage).toBeUndefined();
        expect(l.missionData.listeningScript).toBeUndefined();
        expect(l.applyData.tutorSteps[0].listeningScript).toBe(e.apply.text);
        expect(l.missionData.tutorSteps[1].listeningScript).toBe(e.mission.text);
      } else {
        expect(l.missionData.readingPassage.blocks[0].content).toBe(e.mission.text);
        expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
      }
    }
  }
});

test('early workload discussion raises concerns without inventing an approved schedule', () => {
  const e = fameEpisodes[1];
  expect(e.intro).toStartWith('Three weeks after signing');
  expect(e.apply.dialogue![0]![1]).toContain('three interviews, a rehearsal and a late-night recording session');
  expect(e.apply.dialogue![2]![1]).toContain('growing faster than expected');
  expect(e.closing).toContain('has not been agreed yet');
  expect(e.mission.evidence).toContain('without supplied counts');
});

test('privacy source distinguishes polite refusal, posted judgement and a prepared rather than published message', () => {
  const e = fameEpisodes[2];
  expect(e.apply.text).toContain('politely declined a photograph because you were exhausted');
  expect(e.apply.text).toContain('someone’s judgement');
  expect(e.apply.text).toContain('Jisoo is preparing a short message');
  expect(e.mission.text).toContain('We have not announced a new campaign');
  expect(e.mission.evidence).toContain('Poster identity and motives are not supplied');
  expect(e.closing).toContain('without a full campaign or a confirmed public result');
});

test('song postponement is about campaign fit, and branding is a proposal without a blanket ban', () => {
  const song = fameEpisodes[3], image = fameEpisodes[4];
  expect(song.apply.text).toContain('slow, reflective new song');
  expect(song.apply.text).toContain('praises the writing');
  expect(song.apply.text).toContain('suggests postponing the song');
  expect(song.apply.text).toContain('No release decision is reached here');
  expect(song.mission.text).toContain('not a decision to release it without agreement');
  expect(song.mission.evidence).toContain('do not identify her as Chapter 3’s unnamed producer');
  expect(image.apply.dialogue![6]![1]).toContain('not necessarily the intention');
  expect(image.closing).toContain('not a confirmed campaign or an absolute ban');
});

test('Osaka break and request precede agreement, while both colleagues acknowledge their specific coordination mistakes', () => {
  expect(fameEpisodes[6].intro).toContain('middle of the promotional tour');
  expect(fameEpisodes[6].apply.situation).toContain('Osaka');
  expect(fameEpisodes[6].apply.dialogue![4]![1]).toContain('Natsumi has called for a break');
  expect(fameEpisodes[6].closing).toContain('revised arrangements are not yet agreed');
  expect(fameEpisodes[7].apply.dialogue![3]![1]).toContain('without consulting you');
  expect(fameEpisodes[7].apply.dialogue![6]![1]).toContain('raised the concern earlier');
  expect(fameEpisodes[7].mission.evidence).toContain('not proof of actual lost views');
  expect(fameEpisodes[8].apply.text).toContain('After reviewing contractual commitments and discussing alternatives');
  expect(fameEpisodes[8].apply.text).toContain('Apex agrees to revise the schedule');
  expect(fameEpisodes[8].mission.text).toContain('Those details still need arranging');
  expect(fameEpisodes[8].mission.text).toContain('fewer appearances could slow growth');
});

test('ending records a new version and completes the tour, but does not confirm release or festival song inclusion', () => {
  const e = fameEpisodes[9];
  expect(e.intro).toStartWith('Several weeks later');
  expect(e.apply.dialogue![3]![1]).toContain('recording the new version today');
  expect(e.apply.situation).toContain('revised tour ends');
  expect(e.apply.dialogue![2]![1]).toContain('agreed to consider including it');
  expect(e.apply.dialogue![2]![1]).toContain('set list is not settled');
  expect(e.mission.evidence).toContain('do not identify it as Quiet Streets');
  expect(e.closing).toContain('Its inclusion and the performance remain ahead');
  const facing = JSON.stringify(lessons.map(({ storyData, ...rest }) => rest));
  expect(facing).not.toMatch(/\b(?:boyfriend|girlfriend|romantic|dating)\b|Kamo House|Eastbridge|Mrs\. Takeda|diagnosed|prescribed/);
  expect(e.choices[3]![3]).toBe('B');
  expect(e.choices[3]![2]).toContain('release is not named');
});

test('keyed exercises track actual mistakes, and recompilation preserves saved identity, artwork and feedback', () => {
  for (const n of storyLessonNumbers) {
    const e = fameEpisodes[n], l = lesson(n);
    expect(l.exerciseData.chooseItems).toHaveLength(6); expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.answers.map((v: any) => v.text)).toEqual(e.choose.map(v => v[1]));
    e.choose.forEach(([sentence, answer]) => expect(sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ') || []).toContain(answer));
    expect(l.exerciseData.stepBTutorSteps[1].answerKey.map((v: any) => v.text)).toEqual(e.choices.map((v, i) => `${i + 1}. ${v[3]} - ${v[v[3] === 'A' ? 1 : 2]}`));
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
  }
  const previous = { id: 'keep-id', status: 'published', backgroundImage: 'keep.webp', studentNotes: { text: 'keep' },
    introductionData: { introImage: 'intro.webp' }, applyData: { situationImage: 'apply.webp' }, missionData: { image: 'mission.webp', listeningScript: 'obsolete' },
    feedbackData: { ...lesson(1).feedbackData, categories: [{ title: 'KEEP' }] } };
  const original = JSON.stringify(previous), l = buildFameLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep.webp'); expect(l.introductionData.introImage).toBe('intro.webp');
  expect(l.applyData.situationImage).toBe('apply.webp'); expect(l.missionData.image).toBe('mission.webp');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]); expect(JSON.stringify(previous)).toBe(original);
  expect(l.missionData.listeningScript).toBeUndefined();
});

test('continuity and dynamic checkpoints use the chapter sources with local guarded authoring', () => {
  expect(lesson(1).storyData.previousSummary).toBe(contractEpisodes[9].closing);
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(fameEpisodes[storyLessonNumbers[i - 1]!].closing);
  const available = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(available.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L7-C4-5-review', 'conversational-skills-L7-C4-10-review']);
  const prompt = checkpointPrompt(lessons.slice(4), summarizeCheckpointEvidence([], []));
  expect(prompt).toContain('Level 7, TOEIC 550-780'); expect(prompt).toContain('run on empty');
  expect(prompt).toContain('I want to perform WELL'); expect(prompt).toContain('Do not identify or invent student weaknesses');
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'7:4': { title: 'The Price of Fame'");
  expect(writer).toContain('Concurrent edit detected'); expect(writer).toContain('Full record read-back mismatch');
  const source = readFileSync(new URL('../content/conversational-skills/en/level-7-chapter-4/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
});
