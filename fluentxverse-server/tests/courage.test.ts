import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { courageEpisodes, courageId, buildCourageChapter, buildCourageLesson } from '../content/conversational-skills/en/level-8-chapter-5/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints, checkpointPrompt, summarizeCheckpointEvidence } from '../src/services/checkpointLesson.service';
import { conversationalLanguageTarget, conversationalLanguageInstructions } from '../../shared/conversationalLanguage';
import { getLevelBadge } from '../src/services/lessonMaterial.service';

const lessons: any[] = buildCourageChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);

test('The Courage to Speak uses the confirmed Level 8 range and current expression/guide pointers', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  const phrases = new Set<string>();
  for (const n of storyLessonNumbers) {
    const e = courageEpisodes[n], l = lesson(n), step = l.learnData.steps[0];
    expect([l.id, l.level, l.chapter, l.status]).toEqual([courageId(n), 8, 5, 'draft']);
    expect(l.chapterName).toBe('The Courage to Speak'); expect(l.storyData.storyTitle).toBe('The Things We Don’t Say');
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
    const e = courageEpisodes[n], l = lesson(n), guide = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
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

test('opening uses supplied pause and corrected outside edit without fabricating an intervening chapter or restored trust', () => {
  const e = courageEpisodes[1];
  expect(e.intro).toContain('three weeks');
  expect(e.apply.dialogue![2]![1]).toContain('someone outside our team');
  expect(e.apply.dialogue![3]![1]).toContain('We did not create it');
  expect(e.apply.dialogue![5]![1]).toContain('process for correcting mistakes');
  expect(e.apply.dialogue![7]![1]).toContain('ask the people affected what they need');
  expect(e.mission.evidence).toContain('no uploader name or correction method');
  expect(e.closing).toContain('does not erase its consequences');
});

test('company rationale is attributed and new forum agreement creates a committee without final affordability or recording permission', () => {
  expect(courageEpisodes[2].apply.text).toContain('not independently verified results');
  expect(courageEpisodes[2].apply.text).toContain('did not require endorsing the whole proposal');
  const e = courageEpisodes[3];
  expect(e.apply.text).toContain('address ideas rather than attack individuals');
  expect(e.apply.text).toContain('Farah asks for transparent application requirements');
  expect(e.apply.text).toContain('agree to establish a resident advisory committee');
  expect(e.apply.text).toContain('no new blanket permission to record or broadcast');
  expect(e.mission.evidence).toContain('Do not carry older forum permission forward');
});

test('first committee meeting has three priorities after four hours without guaranteed business eligibility or completed tasks', () => {
  const e = courageEpisodes[4];
  expect(e.intro).toStartWith('Two weeks later');
  expect(e.apply.dialogue![2]![1]).toContain('cannot guarantee every business will qualify');
  expect(e.apply.dialogue![5]![1]).toBe('Publish clearer project information. Assess relocation needs. Give residents a formal opportunity to respond before final decisions.');
  expect(e.apply.dialogue![8]![1]).toContain('four hours');
  expect(e.closing).toContain('without claiming a complete solution or completed tasks');
});

test('return episode has reviewed intended uses and does not invent equal-income statistics among contributors', () => {
  const e = courageEpisodes[6];
  expect(e.apply.dialogue![4]![1]).toContain('Yuna, Farah and Mr. Hayashi');
  expect(e.apply.dialogue![5]![1]).toContain('not a substitute for checking');
  expect(e.apply.dialogue![7]![1]).toContain('rent and daily decisions');
  expect(e.apply.dialogue![7]![1]).toContain('changing careers later in life');
  expect(e.mission.evidence).toContain('No statistics dataset, exact figures, equal incomes');
});

test('partial achievements distinguish company commitments from completed repayment and a one-year extension', () => {
  const e = courageEpisodes[7];
  expect(e.intro).toStartWith('Several months after the forum');
  expect(e.apply.dialogue![0]![1]).toContain('met a financial adviser and negotiated');
  expect(e.apply.dialogue![2]![1]).toContain('another year');
  expect(e.apply.dialogue![4]![1]).toContain('still need to improve the business');
  expect(e.apply.dialogue![7]![1]).toContain('rather than say the assessment is already published');
  expect(e.apply.dialogue![8]![1]).toContain('Mr. Nakahara has arrived');
  expect(e.mission.evidence).toContain('No new public permission for private finances');
});

test('season finale and one-year story ending preserve ongoing work and visitor choice rather than perfect solutions or a new crisis', () => {
  const season = courageEpisodes[8], ending = courageEpisodes[9];
  expect(season.apply.text).toContain('first season’s final episode without a new guest');
  expect(season.apply.text).toContain('sometimes the responsible action is to respect a wish for silence');
  expect(season.closing).toContain('without claiming that every issue or all future podcast work has ended');
  expect(ending.intro).toStartWith('One year after the first episode');
  expect(ending.intro).toContain('affordability and displacement concerns remain');
  expect(ending.intro).toContain('modest improvement');
  expect(ending.apply.roles).toEqual(['the visitor', 'Emi']);
  expect(ending.apply.dialogue![5]![1]).toContain('whether or not it becomes part of a programme');
  expect(ending.mission.evidence).toContain('not identified as Akari');
  expect(ending.mission.evidence).toContain('Leila editing a new episode');
  expect(ending.closing).toContain('The story ends');
  expect(ending.closing).not.toMatch(/new crisis|next chapter|to be continued/i);
});

test('keyed exercises track actual mistakes, and recompilation preserves saved identity, artwork and feedback', () => {
  for (const n of storyLessonNumbers) {
    const e = courageEpisodes[n], l = lesson(n);
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
  const original = JSON.stringify(previous), l = buildCourageLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep.webp'); expect(l.introductionData.introImage).toBe('intro.webp');
  expect(l.applyData.situationImage).toBe('apply.webp'); expect(l.missionData.image).toBe('mission.webp');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]); expect(JSON.stringify(previous)).toBe(original);
  expect(l.missionData.listeningScript).toBeUndefined();
});

test('continuity and dynamic checkpoints use the chapter sources with local guarded authoring', () => {
  expect(lesson(1).storyData.previousSummary).toContain('releases have paused for three weeks');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(courageEpisodes[storyLessonNumbers[i - 1]!].closing);
  const available = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(available.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L8-C5-5-review', 'conversational-skills-L8-C5-10-review']);
  const prompt = checkpointPrompt(lessons.slice(4), summarizeCheckpointEvidence([], []));
  expect(prompt).toContain('Level 8, TOEIC 785-940'); expect(prompt).toContain('put figures in context');
  expect(prompt).toContain('The FIGures MATter'); expect(prompt).toContain('Do not identify or invent student weaknesses');
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'8:5': { title: 'The Courage to Speak'");
  expect(writer).toContain('Concurrent edit detected'); expect(writer).toContain('Full record read-back mismatch');
  const source = readFileSync(new URL('../content/conversational-skills/en/level-8-chapter-5/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
});
