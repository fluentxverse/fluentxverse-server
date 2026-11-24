import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { encoreEpisodes, encoreId, buildEncoreChapter, buildEncoreLesson } from '../content/conversational-skills/en/level-7-chapter-5/build';
import { fameEpisodes } from '../content/conversational-skills/en/level-7-chapter-4/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints, checkpointPrompt, summarizeCheckpointEvidence } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildEncoreChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);

test('One Last Encore uses the confirmed Level 7 range and current expression/guide pointers', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  const phrases = new Set<string>();
  for (const n of storyLessonNumbers) {
    const e = encoreEpisodes[n], l = lesson(n), step = l.learnData.steps[0];
    expect([l.id, l.level, l.chapter, l.status]).toEqual([encoreId(n), 7, 5, 'draft']);
    expect(l.chapterName).toBe('One Last Encore'); expect(l.storyData.storyTitle).toBe('Beyond the Spotlight');
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
    const e = encoreEpisodes[n], l = lesson(n), guide = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
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

test('festival scale remains an opportunity, while Quiet Streets inclusion advances from consideration to agreement', () => {
  expect(encoreEpisodes[1].intro).toStartWith('Six weeks before');
  expect(encoreEpisodes[1].apply.dialogue![0]![1]).toContain('main stage');
  expect(encoreEpisodes[1].apply.dialogue![4]![1]).toContain('Luis will be able to coordinate');
  expect(encoreEpisodes[1].mission.evidence).toContain('No exact attendance');
  const e = encoreEpisodes[2];
  expect(e.apply.text).toContain('Apex has now agreed to that compromise');
  expect(e.mission.text).toContain('beyond an agreement merely to consider it');
  expect(e.mission.text).toContain('We have not named that following song');
  expect(e.closing).toContain('festival performance is still ahead');
});

test('venue memory corrects twelve to thirteen including the owner without debt or a completed mentoring promise', () => {
  const e = encoreEpisodes[3];
  expect(e.apply.text).toContain('Kai remembers twelve');
  expect(e.apply.text).toContain('thirteen, because he was listening too');
  expect(e.apply.text).toContain('Kai owes him nothing');
  expect(e.mission.text).toContain('asks Kai to offer a similar chance to someone else someday');
  expect(e.mission.text).toContain('without claiming to have already selected a musician');
  expect(e.trivia).toContain('not mean thirteen audience members plus the owner');
});

test('rehearsal cue mismatch is corrected before the festival and does not remove the need for alternatives', () => {
  const e = encoreEpisodes[4];
  expect(e.apply.dialogue![0]![1]).toContain('bright red');
  expect(e.apply.dialogue![0]![1]).toContain('soft blue');
  expect(e.apply.dialogue![2]![1]).toContain('sheet is outdated');
  expect(e.apply.dialogue![6]![1]).toContain('next rehearsal works correctly');
  expect(e.apply.dialogue![7]![1]).toContain('prepare a backup plan');
  expect(e.mission.evidence).toContain('Future festival playback issue remains unknown');
});

test('night-before scene offers perspective and original lyrics rather than certainty about the whole future', () => {
  const e = encoreEpisodes[6];
  expect(e.apply.dialogue![2]![1]).toContain('one performance will not decide your entire future');
  expect(e.apply.dialogue![5]![1]).toContain('music that matters to me');
  expect(e.mission.evidence).toContain('original Paper Skyline lyric page');
  expect(e.mission.evidence).toContain('Thousands might listen tomorrow');
  expect(e.closing).toContain('does not have to decide his entire future');
});

test('playback fault has checked equipment and approved opening before repair, planned set and permitted reprise', () => {
  const e = encoreEpisodes[7];
  expect(e.apply.dialogue![0]![1]).toContain('One audio playback system has a fault');
  expect(e.apply.dialogue![4]![1]).toContain('needed microphones and instruments are working');
  expect(e.apply.dialogue![6]![1]).toContain('manager has approved it');
  expect(e.apply.dialogue![7]![1]).toContain('wrote the song that way originally');
  expect(e.closing).toContain('repair is still pending when he walks onstage');
  const text = encoreEpisodes[8].apply.text!;
  expect(text.indexOf('technical team restores playback')).toBeLessThan(text.indexOf('continues with the planned performance'));
  expect(text).toContain('finishes that set with Paper Skyline');
  expect(text).toContain('festival manager then signals');
  expect(text).toContain('brief acoustic reprise of Paper Skyline');
  expect(encoreEpisodes[8].mission.text).toContain('before Kai continued the planned set');
  expect(encoreEpisodes[8].closing).toContain('festival performance is complete');
});

test('finale keeps independent partnership, unnamed singles, leadership opportunity and newcomer welcome precise', () => {
  const e = encoreEpisodes[9];
  expect(e.intro).toStartWith('Several months later');
  expect(e.intro).toContain('both new singles');
  expect(e.intro).toContain('remains independent while working with Apex');
  expect(e.intro).toContain('Maya has an opportunity');
  expect(e.apply.roles).toEqual(['the new musician', 'Kai']);
  expect(e.apply.dialogue![4]![1]).toContain('written songs for years');
  expect(e.apply.dialogue![7]![1]).toContain('something you are proud of');
  expect(e.closing).toContain('passing support forward as she begins to play');
  expect(e.closing).toContain('Beyond the Spotlight ends');
  expect(e.mission.evidence).toContain('no titles, chart ranks, sales');
  const closing = e.closing;
  expect(closing).not.toMatch(/cliffhanger|next chapter|new crisis|to be continued/i);
  const facing = JSON.stringify(lessons.map(({ storyData, ...rest }) => rest));
  expect(facing).not.toMatch(/\b(?:boyfriend|girlfriend|romantic|dating)\b|Kamo House|Eastbridge|Mrs\. Takeda/);
});

test('keyed exercises track actual mistakes, and recompilation preserves saved identity, artwork and feedback', () => {
  for (const n of storyLessonNumbers) {
    const e = encoreEpisodes[n], l = lesson(n);
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
  const original = JSON.stringify(previous), l = buildEncoreLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep.webp'); expect(l.introductionData.introImage).toBe('intro.webp');
  expect(l.applyData.situationImage).toBe('apply.webp'); expect(l.missionData.image).toBe('mission.webp');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]); expect(JSON.stringify(previous)).toBe(original);
  expect(l.missionData.listeningScript).toBeUndefined();
});

test('continuity and dynamic checkpoints use the chapter sources with local guarded authoring', () => {
  expect(lesson(1).storyData.previousSummary).toBe(fameEpisodes[9].closing);
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(encoreEpisodes[storyLessonNumbers[i - 1]!].closing);
  const available = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(available.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L7-C5-5-review', 'conversational-skills-L7-C5-10-review']);
  const prompt = checkpointPrompt(lessons.slice(4), summarizeCheckpointEvidence([], []));
  expect(prompt).toContain('Level 7, TOEIC 550-780'); expect(prompt).toContain('have a lot on your mind');
  expect(prompt).toContain('ToMORrow MATters'); expect(prompt).toContain('Do not identify or invent student weaknesses');
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'7:5': { title: 'One Last Encore'");
  expect(writer).toContain('Concurrent edit detected'); expect(writer).toContain('Full record read-back mismatch');
  const source = readFileSync(new URL('../content/conversational-skills/en/level-7-chapter-5/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
});
