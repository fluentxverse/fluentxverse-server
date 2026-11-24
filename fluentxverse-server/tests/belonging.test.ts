import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { belongingEpisodes, belongingId, buildBelongingChapter, buildBelongingLesson } from '../content/conversational-skills/en/level-8-chapter-3/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints, checkpointPrompt, summarizeCheckpointEvidence } from '../src/services/checkpointLesson.service';
import { conversationalLanguageTarget, conversationalLanguageInstructions } from '../../shared/conversationalLanguage';
import { closedDoorsEpisodes } from '../content/conversational-skills/en/level-8-chapter-2/build';
import { getLevelBadge } from '../src/services/lessonMaterial.service';

const lessons: any[] = buildBelongingChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);

test('The Price of Belonging uses the confirmed Level 8 range and current expression/guide pointers', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  const phrases = new Set<string>();
  for (const n of storyLessonNumbers) {
    const e = belongingEpisodes[n], l = lesson(n), step = l.learnData.steps[0];
    expect([l.id, l.level, l.chapter, l.status]).toEqual([belongingId(n), 8, 3, 'draft']);
    expect(l.chapterName).toBe('The Price of Belonging'); expect(l.storyData.storyTitle).toBe('The Things We Don’t Say');
    expect(l.authoringLanguageTarget).toBe('TOEIC 785-940'); expect(l.supportLanguage).toBe('en'); expect(l.goalTextJp).toBe('');
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
    const e = belongingEpisodes[n], l = lesson(n), guide = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(wordCount(e.goal)).toBeLessThanOrEqual(15); expect(wordCount(e.intro)).toBeLessThanOrEqual(100);
    expect(l.missionData.situation).toMatch(/^You are (Emi|Riku)\. Your tutor is /);
    expect(guide.instruction).toContain('tutor speaks first');
    expect(guide.scripts[0].text).toContain(`I'll be ${e.mission.roles[0]}. Please be ${e.mission.roles[1]}`);
    expect(guide.scripts[1].text).toBe(`1. ${e.mission.lines[0]}`);
    expect(e.mission.lines[0]).not.toMatch(/asks:|Tell me one thing|What can you ask/);
    if (e.skill === 'speaking') {
      expect(l.applyData.dialogueLines).toHaveLength(10);
      e.apply.dialogue!.forEach(([speaker], i) => expect(speaker).toBe(e.apply.roles![i % 2]!));
      expect(wordCount(e.apply.dialogue!.map(v => v[1]).join(' '))).toBeLessThanOrEqual(220);
    } else {
      expect(e.apply.text).not.toBe(e.mission.text);
      for (const text of [e.apply.text!, e.mission.text!]) expect(wordCount(text)).toBeLessThanOrEqual(e.skill === 'listening' ? 130 : 280);
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

test('Level 8 score range and visible badge are course-specific and keep earlier language bands intact', () => {
  expect(conversationalLanguageTarget(8)).toMatchObject({ toeicMin: 785, toeicMax: 940, supportLanguage: 'en', stepAItemCount: 4 });
  expect(conversationalLanguageInstructions(8)).toContain('Level 8, TOEIC 785-940');
  for (const level of [6, 7]) expect(conversationalLanguageTarget(level)).toMatchObject({ toeicMin: 550, toeicMax: 780 });
  expect(getLevelBadge(8, 'conversational-skills')).toBe('TOEIC 785–940');
  expect(getLevelBadge(8)).toBe('INTERMEDIATE');
  for (const course of ['business-english', 'workplace-communication', 'daily-dispatch']) expect(getLevelBadge(8, course)).toBe('INTERMEDIATE');
  for (const l of lessons) expect(l.levelBadge).toBe('TOEIC 785–940');
  const editor = readFileSync(new URL('../../fluentxverse-dashboard/src/pages/ConversationalSkillsEditorPage.tsx', import.meta.url), 'utf8');
  expect(editor).toContain("8: 'TOEIC 785–940'");
});

test('redevelopment aims, community stakes and support remain proposals with consultation ahead', () => {
  const e = belongingEpisodes[1];
  expect(e.intro).toStartWith('On Monday');
  expect(e.apply.dialogue![0]![1]).toContain('housing, improve accessibility and attract investment');
  expect(e.apply.dialogue![2]![1]).toContain('next week');
  expect(e.apply.dialogue![4]![1]).toContain('still discussing possible support');
  expect(e.apply.dialogue![5]![1]).toContain('premature to describe assistance as guaranteed');
  expect(e.closing).toContain('support remains unsettled');
});

test('Yuna remains employed with relocation undecided and Farah requests individual assessment without a guaranteed tenancy', () => {
  expect(belongingEpisodes[2].apply.text).toContain('thirty and works full-time at a supermarket');
  expect(belongingEpisodes[2].apply.text).toContain('commuting costs and distance from her mother');
  expect(belongingEpisodes[2].apply.text).toContain('She has not agreed to move');
  expect(belongingEpisodes[2].mission.text).toContain('no wage figure, household budget or final relocation plan');
  const e = belongingEpisodes[3];
  expect(e.apply.text).toContain('Malaysian and has lived in Japan for six years');
  expect(e.apply.text).toContain('stable income and a permanent job');
  expect(e.apply.text).toContain('clearer contracts, translated information or professional interpretation');
  expect(e.closing).toContain('policy change, legal outcome and tenancy remain unconfirmed');
});

test('unequal starting resources do not erase effort, and uncle’s help is a location connection rather than invented funding', () => {
  const e = belongingEpisodes[4];
  expect(e.apply.dialogue![1]![1]).toContain('less time for internships');
  expect(e.apply.dialogue![3]![1]).toContain('effort matters');
  expect(e.apply.dialogue![4]![1]).toContain('helped me find an affordable location');
  expect(e.apply.dialogue![5]![1]).toContain('does not erase the work');
  expect(e.mission.evidence).toContain('no claim he financed it');
});

test('Mr Hayashi’s reported age-related questions are qualified and temporary café work does not become a permanent resolution', () => {
  const e = belongingEpisodes[6];
  expect(e.intro).toContain('fifty-eight');
  expect(e.apply.dialogue![0]![1]).toContain('restructuring');
  expect(e.apply.dialogue![0]![1]).toContain('more than thirty');
  expect(e.apply.dialogue![2]![1]).toContain('difficult to prove');
  expect(e.apply.dialogue![4]![1]).toContain('completed professional training');
  expect(e.apply.dialogue![8]![1]).toContain('temporary administrative work');
  expect(e.mission.evidence).toContain('separate from the earlier Level 7 entertainment lawyer');
  expect(e.closing).toContain('without proving every rejection’s cause');
});

test('housing support and prices stay open, while private renovation debt is not blamed entirely on redevelopment or published', () => {
  expect(belongingEpisodes[7].apply.dialogue![2]![1]).toContain('still evaluating possible relocation support');
  expect(belongingEpisodes[7].apply.dialogue![7]![1]).toContain('welcome better infrastructure with reservations');
  expect(belongingEpisodes[7].closing).toContain('prices and relocation support unresolved');
  const e = belongingEpisodes[8];
  expect(e.apply.text).toContain('borrowed to renovate the kitchen');
  expect(e.apply.text).toContain('has not discussed a repayment plan');
  expect(e.apply.text).toContain('Even without redevelopment');
  expect(e.apply.text).toContain('Emi agrees');
  expect(e.mission.text).toContain('future public statement');
  expect(e.mission.text).toContain('would not automatically release these private details');
});

test('forum recording and clipped context keep public/private boundaries, advisory proposal status and uploader uncertainty intact', () => {
  const e = belongingEpisodes[9];
  expect(e.intro).toStartWith('A week later');
  expect(e.intro).toContain('organiser permission and clear participant notices');
  expect(e.apply.dialogue![1]![1]).toContain('practical support, fair negotiations');
  expect(e.apply.dialogue![2]![1]).toContain('whether redevelopment happened or not');
  expect(e.apply.dialogue![5]![1]).toContain('take the suggestion to her company');
  expect(e.apply.dialogue![7]![1]).toContain('does not identify the uploader');
  expect(e.apply.dialogue![8]![1]).toContain('only been online an hour');
  expect(JSON.stringify(e.apply.dialogue)).not.toMatch(/renovation|kitchen|loan|substantial debt/);
  expect(e.mission.lines).toContain('Do public remarks authorise use of an earlier private conversation?');
  expect(e.closing).toContain('no final agreement');
  expect(e.closing).toContain('response and redevelopment decisions remain unresolved');
});

test('keyed exercises track actual mistakes, and recompilation preserves saved identity, artwork and feedback', () => {
  for (const n of storyLessonNumbers) {
    const e = belongingEpisodes[n], l = lesson(n);
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
  const original = JSON.stringify(previous), l = buildBelongingLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep.webp'); expect(l.introductionData.introImage).toBe('intro.webp');
  expect(l.applyData.situationImage).toBe('apply.webp'); expect(l.missionData.image).toBe('mission.webp');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]); expect(JSON.stringify(previous)).toBe(original);
  expect(l.missionData.listeningScript).toBeUndefined();
});

test('continuity and dynamic checkpoints use the chapter sources with local guarded authoring', () => {
  expect(lesson(1).storyData.previousSummary).toBe(closedDoorsEpisodes[9].closing);
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(belongingEpisodes[storyLessonNumbers[i - 1]!].closing);
  const available = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(available.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L8-C3-5-review', 'conversational-skills-L8-C3-10-review']);
  const prompt = checkpointPrompt(lessons.slice(4), summarizeCheckpointEvidence([], []));
  expect(prompt).toContain('Level 8, TOEIC 785-940'); expect(prompt).toContain('question an age-related assumption');
  expect(prompt).toContain('He describes the INterview QUEStions'); expect(prompt).toContain('Do not identify or invent student weaknesses');
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'8:3': { title: 'The Price of Belonging'");
  expect(writer).toContain('Concurrent edit detected'); expect(writer).toContain('Full record read-back mismatch');
  const source = readFileSync(new URL('../content/conversational-skills/en/level-8-chapter-3/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
});
