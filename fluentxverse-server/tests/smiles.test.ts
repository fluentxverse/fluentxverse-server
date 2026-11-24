import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { smilesEpisodes, smilesId, buildSmilesChapter, buildSmilesLesson } from '../content/conversational-skills/en/level-8-chapter-1/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints, checkpointPrompt, summarizeCheckpointEvidence } from '../src/services/checkpointLesson.service';
import { conversationalLanguageTarget, conversationalLanguageInstructions } from '../../shared/conversationalLanguage';
import { getLevelBadge } from '../src/services/lessonMaterial.service';

const lessons: any[] = buildSmilesChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);

test('Behind the Smiles uses the confirmed Level 8 range and current expression/guide pointers', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  const phrases = new Set<string>();
  for (const n of storyLessonNumbers) {
    const e = smilesEpisodes[n], l = lesson(n), step = l.learnData.steps[0];
    expect([l.id, l.level, l.chapter, l.status]).toEqual([smilesId(n), 8, 1, 'draft']);
    expect(l.chapterName).toBe('Behind the Smiles'); expect(l.storyData.storyTitle).toBe('The Things We Don’t Say');
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
    const e = smilesEpisodes[n], l = lesson(n), guide = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(wordCount(e.goal)).toBeLessThanOrEqual(15); expect(wordCount(e.intro)).toBeLessThanOrEqual(100);
    expect(l.missionData.situation).toMatch(/^You are (Emi)\. Your tutor is /);
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

test('new podcast cast and voluntary invitation are independent of the earlier music storyline', () => {
  expect(smilesEpisodes[1].intro).toContain('ten years in journalism');
  expect(smilesEpisodes[1].apply.dialogue![3]![1]).toContain('invite them rather than convince them');
  expect(smilesEpisodes[1].apply.dialogue![7]![1]).toContain('exploiting someone’s experience');
  for (const l of lessons) {
    expect(l.storyData.storyTitle).toBe('The Things We Don’t Say');
    expect(JSON.stringify(l)).not.toMatch(/Spotlight Works|Apex Entertainment|Kai Nakamura|Paper Skyline|Quiet Streets/);
  }
});

test('social-media selection and retirement isolation remain qualified personal accounts', () => {
  expect(smilesEpisodes[2].mission.text).toContain('not a fixed rule for every post');
  expect(smilesEpisodes[2].mission.text).toContain('comparison predates social media');
  expect(smilesEpisodes[2].mission.text).toContain('still need her permission');
  expect(smilesEpisodes[3].apply.text).toContain('lived in Aokawa for almost forty years');
  expect(smilesEpisodes[3].mission.text).toContain('neither attendance nor a lasting change');
  expect(smilesEpisodes[3].mission.text).toContain('not knowing that groups exist');
});

test('workplace account distinguishes official time, perceived recognition and an explicit order', () => {
  const e = smilesEpisodes[4];
  expect(e.apply.dialogue![1]![1]).toContain('eight hours');
  expect(e.apply.dialogue![1]![1]).toContain('no exact total');
  expect(e.apply.dialogue![3]![1]).toContain('Not in her account');
  expect(e.apply.dialogue![5]![1]).toContain('without our inventing a written policy');
  expect(e.closing).toContain('values the career');
  expect(e.mission.evidence).toContain('Daisuke running it fourteen hours, not Tomoko');
});

test('guest privacy and separate permissions preserve reported stigma and the later decision not to publish', () => {
  const e = smilesEpisodes[6];
  expect(e.apply.roles).toEqual(['the guest', 'Emi']);
  expect(e.apply.dialogue![0]![1]).toContain('name and workplace remain private');
  expect(e.apply.dialogue![0]![1]).toContain('comfortable with Hana joining');
  expect(e.apply.dialogue![4]![1]).toStartWith('Not direct discrimination');
  expect(e.apply.dialogue![6]![1]).toContain('consider publication for a few days');
  expect(e.closing).toContain('publication remains undecided');
  expect(smilesEpisodes[9].apply.dialogue![5]![1]).toContain('guest decided against publication');
  expect(lesson(6).storyData.characters.find((c: any) => c.id === 'hana').description).toContain('No professional qualification');
});

test('family and parenting choices retain autonomy, competing responsibilities and limits on interpretation', () => {
  expect(smilesEpisodes[7].intro).toContain('twenty-six');
  expect(smilesEpisodes[7].apply.dialogue![6]![1]).toContain('already discussed it with them several times');
  expect(smilesEpisodes[7].closing).toContain('No final family arrangement');
  expect(smilesEpisodes[8].apply.text).toContain('Sayuri, thirty-eight');
  expect(smilesEpisodes[8].apply.text).toContain('enjoys spending time with her nieces and nephews');
  expect(smilesEpisodes[8].mission.text).toContain('Do not replace that statement with a prediction');
  expect(smilesEpisodes[8].mission.text).toContain('no medical explanation, partner history');
  expect(smilesEpisodes[8].mission.text).toContain('Permission to include her conversation');
});

test('launch publishes selected permitted material, accepts a useful criticism and keeps anonymous contact private', () => {
  const e = smilesEpisodes[9];
  expect(e.intro).toStartWith('On Friday at seven');
  expect(e.apply.dialogue![4]![1]).toContain('selected Ayaka and Shun conversations with permission');
  expect(e.apply.dialogue![1]![1]).toContain('financial freedom');
  expect(e.apply.dialogue![7]![1]).toContain('Contacting us is not permission to publish');
  expect(e.apply.dialogue![9]![1]).toContain('without promising an episode');
  expect(e.mission.evidence).toContain('no reply already sent');
  expect(e.closing).toContain('next conversation remains open');
  const facing = JSON.stringify(lessons.map(({ storyData, ...rest }) => rest));
  expect(facing).not.toMatch(/What is your diagnosis|Do you have depression|Do you want children|Tell me about your family trauma/);
});

test('keyed exercises track actual mistakes, and recompilation preserves saved identity, artwork and feedback', () => {
  for (const n of storyLessonNumbers) {
    const e = smilesEpisodes[n], l = lesson(n);
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
  const original = JSON.stringify(previous), l = buildSmilesLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep.webp'); expect(l.introductionData.introImage).toBe('intro.webp');
  expect(l.applyData.situationImage).toBe('apply.webp'); expect(l.missionData.image).toBe('mission.webp');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]); expect(JSON.stringify(previous)).toBe(original);
  expect(l.missionData.listeningScript).toBeUndefined();
});

test('continuity and dynamic checkpoints use the chapter sources with local guarded authoring', () => {
  expect(lesson(1).storyData.previousSummary).toContain('Emi Sato has left her newspaper');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(smilesEpisodes[storyLessonNumbers[i - 1]!].closing);
  const available = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(available.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L8-C1-5-review', 'conversational-skills-L8-C1-10-review']);
  const prompt = checkpointPrompt(lessons.slice(4), summarizeCheckpointEvidence([], []));
  expect(prompt).toContain('Level 8, TOEIC 785-940'); expect(prompt).toContain('keep identifying details confidential');
  expect(prompt).toContain('She agreed to the INterview'); expect(prompt).toContain('Do not identify or invent student weaknesses');
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'8:1': { title: 'Behind the Smiles'");
  expect(writer).toContain('Concurrent edit detected'); expect(writer).toContain('Full record read-back mismatch');
  const source = readFileSync(new URL('../content/conversational-skills/en/level-8-chapter-1/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
});
