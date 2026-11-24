import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { closedDoorsEpisodes, closedDoorsId, buildClosedDoorsChapter, buildClosedDoorsLesson } from '../content/conversational-skills/en/level-8-chapter-2/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints, checkpointPrompt, summarizeCheckpointEvidence } from '../src/services/checkpointLesson.service';
import { conversationalLanguageTarget, conversationalLanguageInstructions } from '../../shared/conversationalLanguage';
import { smilesEpisodes } from '../content/conversational-skills/en/level-8-chapter-1/build';
import { getLevelBadge } from '../src/services/lessonMaterial.service';

const lessons: any[] = buildClosedDoorsChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);

test('Behind Closed Doors uses the confirmed Level 8 range and current expression/guide pointers', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  const phrases = new Set<string>();
  for (const n of storyLessonNumbers) {
    const e = closedDoorsEpisodes[n], l = lesson(n), step = l.learnData.steps[0];
    expect([l.id, l.level, l.chapter, l.status]).toEqual([closedDoorsId(n), 8, 2, 'draft']);
    expect(l.chapterName).toBe('Behind Closed Doors'); expect(l.storyData.storyTitle).toBe('The Things We Don’t Say');
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
    const e = closedDoorsEpisodes[n], l = lesson(n), guide = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
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

test('Akari initially asks for private listening without publication, recording or an invented financial explanation', () => {
  const e = closedDoorsEpisodes[1];
  expect(e.intro).toStartWith('On Monday');
  expect(e.apply.dialogue![4]![1]).toStartWith('Several times');
  expect(e.apply.dialogue![8]![1]).toContain('not ready for a podcast episode');
  expect(e.apply.dialogue![9]![1]).toContain('does not make publication a condition');
  expect(e.mission.evidence).toContain('real name is not supplied');
  expect(e.mission.evidence).toContain('no amount, loan, business detail or redevelopment known yet');
});

test('Yuko distinguishes regret about a relationship from regret about accepting its end', () => {
  const e = closedDoorsEpisodes[2];
  expect(e.apply.text).toContain('forty-two and divorced three years ago');
  expect(e.apply.text).toContain('regrets that they could not make the marriage work, but not accepting that it had ended');
  expect(e.mission.text).toContain('Do not add infidelity, abuse or a plan to reconcile');
  expect(e.mission.text).toContain('does not replace Yuko’s own explanation');
  expect(e.mission.evidence).toContain('publication permission is not established');
});

test('Jun requests information while declining recording, without a complaint or promised outcome', () => {
  const e = closedDoorsEpisodes[3];
  expect(e.apply.text).toContain('family depends on his income');
  expect(e.apply.text).toContain('He declines a recorded interview');
  expect(e.apply.text).toContain('neither a filed complaint nor permission to record or publish');
  expect(e.mission.text).toContain('without making a recorded interview the price');
  expect(e.mission.text).toContain('No employer identity, investigation outcome or guaranteed protection');
  expect(lesson(3).applyData.activityType).toBe('reading');
});

test('general family discussion preserves qualifications while café support stays private and limited to reviewing resources', () => {
  expect(closedDoorsEpisodes[4].apply.dialogue![2]![1]).toContain('when possible');
  expect(closedDoorsEpisodes[4].apply.dialogue![6]![1]).toContain('offering support from demanding sacrifice');
  expect(JSON.stringify(closedDoorsEpisodes[4].apply.dialogue)).not.toContain('Akari');
  const e = closedDoorsEpisodes[6];
  expect(e.apply.dialogue![2]![1]).toContain('twenty years');
  expect(e.apply.dialogue![5]![1]).toContain('reviewing available business-support resources');
  expect(e.apply.dialogue![8]![1]).toContain('keep this between us');
  expect(e.apply.dialogue![9]![1]).toContain('not permission');
  expect(e.closing).toContain('open question rather than proving its contents');
});

test('lease signing is not a completed move, Hana receives no identity, and private material is excluded from the new episode plan', () => {
  const boundaries = closedDoorsEpisodes[7], editorial = closedDoorsEpisodes[8];
  expect(boundaries.intro).toContain('signed a lease');
  expect(boundaries.closing).toContain('future move and family response remain open');
  expect(JSON.stringify(boundaries.apply.dialogue)).not.toContain('Akari');
  expect(boundaries.mission.evidence).toContain('Hana gets broader principle with no identifying details');
  expect(editorial.apply.text).toContain('family might recognise the circumstances');
  expect(editorial.apply.text).toContain('instead of using Akari’s private material');
  expect(editorial.mission.text).toContain('no completed replacement interview or publication date');
  expect(editorial.mission.evidence).toContain('no earlier leak or breach is invented');
});

test('new private business context leaves refusal intact and possible redevelopment unconfirmed', () => {
  const e = closedDoorsEpisodes[9];
  expect(e.intro).toStartWith('Two weeks later');
  expect(e.intro).toContain('parents have no official notice');
  expect(e.intro).toContain('neighbouring businesses have reportedly been contacted');
  expect(e.apply.dialogue![0]![1]).toContain('considering redevelopment');
  expect(e.apply.dialogue![0]![1]).toContain('lease may not be renewed');
  expect(JSON.stringify(e.apply.dialogue)).not.toMatch(/Akari|her father|her parents/);
  expect(e.mission.evidence).toContain('Explicit do not publish, Emi promises');
  expect(e.mission.evidence).toContain('No confirmed eviction, decision/date');
  expect(e.closing).toContain('any connection between the businesses remain unconfirmed');
  expect(e.mission.evidence).toContain('not share Akari’s private details with Daisuke');
});

test('keyed exercises track actual mistakes, and recompilation preserves saved identity, artwork and feedback', () => {
  for (const n of storyLessonNumbers) {
    const e = closedDoorsEpisodes[n], l = lesson(n);
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
  const original = JSON.stringify(previous), l = buildClosedDoorsLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep.webp'); expect(l.introductionData.introImage).toBe('intro.webp');
  expect(l.applyData.situationImage).toBe('apply.webp'); expect(l.missionData.image).toBe('mission.webp');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]); expect(JSON.stringify(previous)).toBe(original);
  expect(l.missionData.listeningScript).toBeUndefined();
});

test('continuity and dynamic checkpoints use the chapter sources with local guarded authoring', () => {
  expect(lesson(1).storyData.previousSummary).toBe(smilesEpisodes[9].closing);
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(closedDoorsEpisodes[storyLessonNumbers[i - 1]!].closing);
  const available = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(available.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L8-C2-5-review', 'conversational-skills-L8-C2-10-review']);
  const prompt = checkpointPrompt(lessons.slice(4), summarizeCheckpointEvidence([], []));
  expect(prompt).toContain('Level 8, TOEIC 785-940'); expect(prompt).toContain('review the available resources');
  expect(prompt).toContain('He agreed to review reSOURces'); expect(prompt).toContain('Do not identify or invent student weaknesses');
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'8:2': { title: 'Behind Closed Doors'");
  expect(writer).toContain('Concurrent edit detected'); expect(writer).toContain('Full record read-back mismatch');
  const source = readFileSync(new URL('../content/conversational-skills/en/level-8-chapter-2/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
});
