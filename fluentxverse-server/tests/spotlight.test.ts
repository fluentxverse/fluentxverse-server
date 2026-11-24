import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildSpotlightChapter, buildSpotlightLesson, spotlightEpisodes, spotlightId } from '../content/conversational-skills/en/level-7-chapter-1/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { conversationalLanguageTarget, conversationalLanguageInstructions } from '../../shared/conversationalLanguage';
import { addAvailableCheckpoints, buildCheckpointLesson, checkpointPrompt, checkpointSlot, summarizeCheckpointEvidence, validateCheckpointContent } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildSpotlightChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);

test('Level 7 uses the owner TOEIC 550-780 band, eight English-only drafts and the agreed skill sequence', () => {
  expect(conversationalLanguageTarget(7)).toMatchObject({ toeicMin: 550, toeicMax: 780, supportLanguage: 'en', stepAType: 'expressions', stepAItemCount: 4 });
  expect(conversationalLanguageInstructions(7)).toContain('Level 7, TOEIC 550-780');
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = spotlightEpisodes[n];
    expect([l.id, l.level, l.chapter, l.status]).toEqual([spotlightId(n), 7, 1, 'draft']);
    expect(l.chapterName).toBe('Before the Spotlight'); expect(l.storyData.storyTitle).toBe('Beyond the Spotlight');
    expect(l.authoringLanguageTarget).toBe('TOEIC 550-780'); expect(l.supportLanguage).toBe('en'); expect(l.goalTextJp).toBe('');
    expect(JSON.stringify(l)).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(wordCount(e.intro)).toBeLessThanOrEqual(90); expect(wordCount(e.goal)).toBeLessThanOrEqual(15);
    expect(conversationalLessonErrors(l)).toEqual([]);
  }
});

test('four contextual expressions and standard guides keep objective first, plain situations and separate questions', () => {
  const expressions = new Set<string>();
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = spotlightEpisodes[n], step = l.learnData.steps[0];
    expect(step.stepType).toBe('expressions'); expect(step.stepName).toBe('STEP A: EXPRESSIONS');
    expect(step.vocabularyItems).toBeUndefined(); expect(step.expressionItems).toHaveLength(4);
    step.expressionItems.forEach((item: any, i: number) => {
      const [phrase, meaning, example] = e.expressions[i]!;
      expect(item.definitionLine).toBe(`<strong>${phrase}</strong> ${meaning}`);
      expect(item.exampleSentence).toBe(`<em>${example}</em>`); expect(example).toContain('<strong>'); expressions.add(phrase);
    });
    expect(step.tutorSteps).toHaveLength(5); expect(step.discussionPart.tutorSteps).toHaveLength(5);
    expect(l.introductionData.lessonGoalSteps[0].script).toStartWith('Our lesson objective today is to');
    expect(l.introductionData.lessonGoalSteps[1].script).toBe(`Here is our situation. ${e.intro}`);
    expect(l.applyData.situationText).not.toMatch(/<[^>]+>/);
    expect(l.applyData.tutorSteps[1].questions).toEqual(e.apply.questions.map(([question, answer]) => ({ question, answer })));
    expect(l.applyData.triviaTutorSteps).toHaveLength(4); expect(l.missionData.grammarTipItems).toHaveLength(5);
    expect(l.missionData2.topics).toHaveLength(3); expect(l.feedbackData.tutorSteps).toHaveLength(6);
    expect(l.feedbackData.categories.map((c: any) => c.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    expect(l.feedbackData.rubricLevels.map((r: any) => r.score)).toEqual([4, 3, 2, 1]);
  }
  expect(expressions.size).toBe(32);
});

test('Step B is the only pronunciation part with meaningful linking, pauses and partial bold stress', () => {
  for (const l of lessons) {
    const step = l.learnData.steps[0], p = l.stepBData.pronunciation;
    expect(step.pronunciationPart).toBeUndefined();
    expect(step.discussionPart.tutorSteps.at(-1).script).toContain('Step B Pronunciation');
    expect(l.stepBData.stepType).toBe('pronunciation'); expect(l.stepBData.grammarTip).toBeUndefined();
    expect(p.phrases).toHaveLength(2); expect(p.tutorSteps).toHaveLength(6);
    expect(JSON.stringify([l.learnData, l.stepBData])).not.toMatch(/Part III|reading cues|\bIPA\b|accents?/i);
    for (const item of p.phrases) {
      expect(item.pronunciationGuide).toMatch(/^\/ .+ \/$/); expect(item.pronunciationGuide).toMatch(/[|‿]/);
      const bold = [...item.exampleSentence.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m: any) => m[1]);
      expect(bold.length).toBeGreaterThan(0); expect(bold.join('')).not.toMatch(/[|‿]/);
      expect(bold.join('').length).toBeLessThan(item.exampleSentence.replace(/<[^>]+>/g, '').length);
    }
  }
});

test('speaking stays short, alternating and tutor-first with concrete roles', () => {
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = spotlightEpisodes[n], guide = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(guide.instruction).toContain('tutor speaks first'); expect(guide.scripts[1].text).toBe(`1. ${e.mission.lines[0]}`);
    expect(l.missionData.situation).toMatch(/^You are (Maya|Kai)\. Your tutor is /);
    expect(guide.scripts[0].text).toContain(`I'll be ${e.mission.roles[0]}. Please be ${e.mission.roles[1]}`);
    if (l.skill === 'speaking') {
      expect(l.applyData.dialogueLines).toHaveLength(10);
      l.applyData.dialogueLines.forEach((line: any, i: number) => expect(line.speaker).toBe(e.apply.roles![i % 2]));
      expect(wordCount(e.apply.dialogue!.map(v => v[1]).join(' '))).toBeLessThanOrEqual(180);
    }
  }
});

test('creative-feedback listening is short, distinct and tutor-only, with revision rather than a changed identity', () => {
  const l = lesson(2), a = l.applyData.tutorSteps[0].listeningScript, b = l.missionData.tutorSteps[1].listeningScript;
  expect(a).not.toBe(b); for (const script of [a, b]) expect(wordCount(script)).toBeLessThanOrEqual(110);
  expect(a).toContain('stronger bass line'); expect(a).toContain('not replace the whole song');
  expect(b).toContain('revised version sounded better'); expect(b).toContain('keeping the song’s identity');
  expect(l.applyData.readingText).toBe(''); expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.listeningScript).toBeUndefined(); expect(l.missionData.readingPassage).toBeUndefined();
});

test('reading missions have fresh visible campaign and clip-comparison evidence', () => {
  for (const n of [3, 8]) {
    const l = lesson(n), text = l.missionData.readingPassage.blocks[0].content;
    expect(text).not.toBe(l.applyData.readingText); expect(wordCount(text)).toBeLessThanOrEqual(220);
    expect(wordCount(l.applyData.readingText)).toBeLessThanOrEqual(220);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  expect(lesson(3).missionData.readingPassage.blocks[0].content).toContain('does not add funding or a fixed release date');
  expect(lesson(3).missionData.readingPassage.blocks[0].content).toContain('without asking him to pretend');
  const compare = lesson(8).missionData.readingPassage.blocks[0].content;
  expect(compare).toContain('does not identify who created or posted either version');
  expect(compare).toContain('two publication enquiries'); expect(compare).toContain('Do not announce completed interviews');
});

test('studio timing, both failed lights and first-video response are preserved without sales or fame claims', () => {
  expect(spotlightEpisodes[4].apply.dialogue![0]![1]).toContain('backup has failed too');
  expect(spotlightEpisodes[4].apply.dialogue![3]![1]).toContain('four hours left');
  expect(spotlightEpisodes[4].apply.dialogue![4]![1]).toContain('camera settings and change the shot list');
  expect(spotlightEpisodes[4].apply.dialogue![8]![1]).toContain('Three hours later');
  expect(spotlightEpisodes[6].intro).toContain('thousands of views');
  expect(spotlightEpisodes[6].apply.dialogue![5]![1]).toContain('does not tell us how many people will buy');
  expect(spotlightEpisodes[6].mission.evidence).toContain('not the later performance clip');
});

test('the live mistake is self-directed, followed by recovery, and distinct from the later viral versions', () => {
  expect(spotlightEpisodes[7].apply.dialogue![2]![1]).toContain('first song was fine');
  expect(spotlightEpisodes[7].apply.dialogue![3]![1]).toContain('got back on track');
  expect(spotlightEpisodes[7].mission.evidence).toContain('source does not establish who later uploads');
  expect(spotlightEpisodes[8].intro).toContain('hundreds of thousands');
  expect(spotlightEpisodes[8].apply.text).toContain('two music publications');
  expect(spotlightEpisodes[8].mission.evidence).toContain('before the next episode establishes it');
});

test('the final edit omits context, response remains planned, and the invitation remains on hold', () => {
  const e = spotlightEpisodes[9];
  expect(e.intro).toContain('removed Kai’s forgotten lyrics');
  expect(e.apply.dialogue![3]![1]).toContain('laughing after forgetting his own lyrics');
  expect(e.apply.dialogue![5]![1]).toContain('can help us set the record straight');
  expect(e.apply.dialogue![9]![1]).toContain('Not yet');
  expect(e.mission.evidence).toContain('not permanently cancelled or restored');
  expect(e.mission.evidence).toContain('not a confirmed venue decision');
  expect(e.closing).toContain('remain unresolved');
});

test('all six/four exercise keys match actual choices and real-error tracking remains available', () => {
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = spotlightEpisodes[n];
    expect(l.exerciseData.chooseItems).toHaveLength(6); expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.answers.map((v: any) => v.text)).toEqual(e.choose.map(v => v[1]));
    expect(l.exerciseData.stepBTutorSteps[1].answerKey.map((v: any) => v.text)).toEqual(e.choices.map((v, i) => `${i + 1}. ${v[3]} - ${v[v[3] === 'A' ? 1 : 2]}`));
    e.choose.forEach(([sentence, answer]) => expect(sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ') || []).toContain(answer));
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
  }
});

test('new cast and continuity preserve caller data, artwork, status and fixed feedback', () => {
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(spotlightEpisodes[storyLessonNumbers[i - 1]!].closing);
  for (const l of lessons) {
    expect(l.storyData.characters.map((c: any) => c.id)).toEqual(['maya', 'natsumi', 'jisoo', 'luis', 'kai']);
    const { storyData, ...facing } = l;
    expect(JSON.stringify(facing)).not.toMatch(/You may play|invented adult|No personal or romantic|\bmonologue\b|boyfriend|girlfriend|\bdating\b|Kamo House|Eastbridge|Mrs\. Takeda/);
  }
  const previous = { id: 'keep-id', status: 'published', backgroundImage: 'keep.webp', studentNotes: { text: 'keep' },
    introductionData: { introImage: 'keep-intro.webp' }, applyData: { situationImage: 'keep-apply.webp' },
    missionData: { image: 'keep-mission.webp', listeningScript: 'obsolete' }, feedbackData: { ...lesson(1).feedbackData, categories: [{ title: 'KEEP' }] } };
  const copy = JSON.stringify(previous), l = buildSpotlightLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep.webp'); expect(l.introductionData.introImage).toBe('keep-intro.webp');
  expect(l.applyData.situationImage).toBe('keep-apply.webp'); expect(l.missionData.image).toBe('keep-mission.webp');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]); expect(JSON.stringify(previous)).toBe(copy);
  expect(l.missionData.listeningScript).toBeUndefined(); expect(l.missionData.readingPassage).toBeUndefined();
});

test('Level 7 validation and checkpoints use English-only expressions and review actual source pronunciation', () => {
  const sources = lessons.slice(0, 4).map(l => ({ ...l, status: 'published' }));
  const available = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  const reviews = available.filter(l => [5, 10].includes(l.lessonNumber));
  expect(reviews.map(l => l.id)).toEqual(['conversational-skills-L7-C1-5-review', 'conversational-skills-L7-C1-10-review']);
  expect(reviews.every(l => l.goalTextJp === '')).toBe(true);
  const prompt = checkpointPrompt(sources, summarizeCheckpointEvidence([], []));
  expect(prompt).toContain('Level 7, TOEIC 550-780'); expect(prompt).toContain('Do not identify or invent student weaknesses');
  expect(prompt).toContain('wear several hats'); expect(prompt).toContain('take‿ON‿a PROject');
  const content = { introduction: 'You are preparing a short music event with a colleague.', introductionJp: '',
    stepA: [1, 2, 3, 4, 1, 2].map((sourceLessonNumber, i) => ({ sourceLessonNumber, sentence: `They was ready for task ${i + 1}.`, answer: `They were ready for task ${i + 1}.` })),
    stepB: [1, 2, 3, 4, 1].map((sourceLessonNumber, i) => ({ sourceLessonNumber, prompt: `Ask for help with task ${i + 1}.`, optionA: 'Could you help me with this?', optionB: 'I helped yesterday.', answer: 'A' as const })),
    challenge1: { situation: 'You are a producer. Your tutor is a colleague.', situationJp: '', instruction: 'Discuss a plan and one constraint.', instructionJp: '', prompts: ['What could we film?', 'What is the time limit?', 'Who will check the setup?'] },
    challenge2: { situation: 'Read the production note.', situationJp: '', title: 'Production note', passage: 'The team will record a short performance at the studio. One colleague will check the camera setup before filming begins. The release date has not been confirmed. Please review the footage together before announcing the next step.', questions: [{ question: 'What will be filmed?', answer: 'A short performance.' }, { question: 'What happens first?', answer: 'A camera setup check.' }, { question: 'Is the release date confirmed?', answer: 'No.' }] },
    challenge3: { situation: 'You are a producer. Your tutor is the artist.', situationJp: '', instruction: 'Explain the confirmed plan.', instructionJp: '', prompts: ['What will be filmed?', 'Who checks the setup?', 'Is a date confirmed?'] } };
  const review = buildCheckpointLesson(checkpointSlot('conversational-skills-L7-C1-5-review')!, sources, validateCheckpointContent(content, [1, 2, 3, 4], 7));
  expect(review.learnData?.steps[0]?.expressionItems).toHaveLength(4); expect(review.stepBData?.pronunciation?.phrases).toHaveLength(4);
  expect(JSON.stringify(review)).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  expect(() => validateCheckpointContent({ ...content, introductionJp: '日本語' }, [1, 2, 3, 4], 7)).toThrow('English-only');
  const invalid = structuredClone(lesson(1)); invalid.goalTextJp = '日本語';
  expect(conversationalLessonErrors(invalid)).toContain('Level 7 content must be English-only.');
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'7:1': { title: 'Before the Spotlight'"); expect(writer).toContain('Concurrent edit detected');
  expect(writer).toContain('Full record read-back mismatch');
  const source = readFileSync(new URL('../content/conversational-skills/en/level-7-chapter-1/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
});
