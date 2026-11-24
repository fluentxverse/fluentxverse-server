import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { contractEpisodes, contractId, buildContractChapter, buildContractLesson } from '../content/conversational-skills/en/level-7-chapter-3/build';
import { algorithmEpisodes } from '../content/conversational-skills/en/level-7-chapter-2/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints, checkpointPrompt, summarizeCheckpointEvidence } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildContractChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);

test('Behind the Contract uses the confirmed Level 7 range and current expression/guide pointers', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  const phrases = new Set<string>();
  for (const n of storyLessonNumbers) {
    const e = contractEpisodes[n], l = lesson(n), step = l.learnData.steps[0];
    expect([l.id, l.level, l.chapter, l.status]).toEqual([contractId(n), 7, 3, 'draft']);
    expect(l.chapterName).toBe('Behind the Contract'); expect(l.storyData.storyTitle).toBe('Beyond the Spotlight');
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
    const e = contractEpisodes[n], l = lesson(n), guide = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(wordCount(e.goal)).toBeLessThanOrEqual(15); expect(wordCount(e.intro)).toBeLessThanOrEqual(90);
    expect(l.missionData.situation).toMatch(/^You are (Natsumi|Kai)\. Your tutor is /);
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

test('advance and recoupment stay scoped to the proposed recording terms without invented debt or figures', () => {
  const e = contractEpisodes[2];
  expect(e.apply.text).toContain('advance would be paid upfront against future royalties');
  expect(e.apply.text).toContain('specified costs before you received additional recording royalties');
  expect(e.apply.text).toContain('not simply an extra bonus');
  expect(e.mission.text).toContain('Do not assume it describes every recording');
  expect(e.mission.evidence).toContain('personal repayment obligations');
  const scripts = `${e.apply.text} ${e.mission.text}`;
  expect(scripts).not.toMatch(/all (?:costs|income|royalties)|personal debt|must repay|\d|[%¥$]/);
  expect(contractEpisodes[1].closing).toContain('no commitment has been made');
});

test('creative suggestions and financial scenarios remain open choices rather than bans or guaranteed results', () => {
  expect(contractEpisodes[3].apply.text).toContain('Kai would still be able to write his own material');
  expect(contractEpisodes[3].apply.text).toContain('does not establish final approval rights');
  expect(contractEpisodes[3].mission.text).toContain('not a finished revision');
  expect(contractEpisodes[3].mission.text).toContain('before assuming either complete freedom or no influence');
  expect(contractEpisodes[4].apply.dialogue![2]![1]).toContain('certain expenses are recoupable');
  expect(contractEpisodes[4].apply.dialogue![6]![1]).toContain('greater financial risk');
  expect(contractEpisodes[4].closing).toContain('without guaranteeing higher income');
  expect(contractEpisodes[4].mission.evidence).toContain('without invented amounts');
});

test('composition and master rights stay distinct, while limited licensing and team roles begin as requests', () => {
  const rights = contractEpisodes[6], team = contractEpisodes[7];
  expect(rights.apply.dialogue![2]![1]).toContain('composition, meaning the song itself, from a particular recording');
  expect(rights.apply.dialogue![4]![1]).toContain('how it was created and the agreements involved');
  expect(rights.closing).toContain('no acceptance by Apex yet');
  expect(team.apply.dialogue![2]![1]).toContain('does not guarantee our involvement');
  expect(team.apply.dialogue![4]![1]).toContain('Nobody is asking you to keep everything the same');
  expect(team.closing).toContain('No role is guaranteed yet');
});

test('two-single counterproposal and two-hour meeting precede a later revised offer and signing', () => {
  const e = contractEpisodes[8];
  expect(e.apply.text).toContain('two new singles instead of a long-term recording commitment');
  expect(e.apply.text).toContain('artist management and creative coordination');
  expect(e.apply.text).toContain('would increase Apex’s risk');
  expect(e.apply.text).toContain('After two hours'); expect(e.apply.text).toContain('without a final agreement');
  expect(e.mission.text).toContain('ask for a response rather than announce a deal');
  expect(contractEpisodes[9].intro).toStartWith('Several days later');
  expect(contractEpisodes[9].apply.dialogue![0]![1]).toContain('signed after the legal review');
  expect(contractEpisodes[9].mission.evidence).toContain('defined recoupable expenses and limited licensing period');
});

test('final ownership applies to existing independent recordings and the proposed Japanese tour remains ahead', () => {
  const e = contractEpisodes[9];
  expect(e.apply.dialogue![2]![1]).toContain('ownership of your existing independent recordings');
  expect(e.apply.dialogue![2]![1]).toContain('new releases have clearly outlined rights and approvals');
  expect(e.apply.dialogue![3]![1]).toContain('management and creative coordination alongside Apex’s team');
  expect(e.apply.dialogue![6]![1]).toContain('recording immediately');
  expect(e.apply.dialogue![6]![1]).toContain('several major Japanese cities');
  expect(e.closing).toContain('timetable discussion are ahead');
  const facing = JSON.stringify(lessons.map(({ storyData, ...rest }) => rest));
  expect(facing).not.toMatch(/\b(?:boyfriend|girlfriend|romantic|dating)\b|Kamo House|Eastbridge|Mrs\. Takeda|Tokyo Dome|ten-year|50%|all future masters/);
});

test('keyed exercises track actual mistakes, and recompilation preserves saved identity, artwork and feedback', () => {
  for (const n of storyLessonNumbers) {
    const e = contractEpisodes[n], l = lesson(n);
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
  const original = JSON.stringify(previous), l = buildContractLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep.webp'); expect(l.introductionData.introImage).toBe('intro.webp');
  expect(l.applyData.situationImage).toBe('apply.webp'); expect(l.missionData.image).toBe('mission.webp');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]); expect(JSON.stringify(previous)).toBe(original);
  expect(l.missionData.listeningScript).toBeUndefined();
});

test('continuity and dynamic checkpoints use the chapter sources with local guarded authoring', () => {
  expect(lesson(1).storyData.previousSummary).toBe(algorithmEpisodes[9].closing);
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(contractEpisodes[storyLessonNumbers[i - 1]!].closing);
  const available = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(available.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L7-C3-5-review', 'conversational-skills-L7-C3-10-review']);
  const prompt = checkpointPrompt(lessons.slice(4), summarizeCheckpointEvidence([], []));
  expect(prompt).toContain('Level 7, TOEIC 550-780'); expect(prompt).toContain('grant a limited licence');
  expect(prompt).toContain('ASK‿about‿a reCORDing'); expect(prompt).toContain('Do not identify or invent student weaknesses');
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'7:3': { title: 'Behind the Contract'");
  expect(writer).toContain('Concurrent edit detected'); expect(writer).toContain('Full record read-back mismatch');
  const source = readFileSync(new URL('../content/conversational-skills/en/level-7-chapter-3/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
});
