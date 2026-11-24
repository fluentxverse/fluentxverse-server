import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { algorithmEpisodes, algorithmId, buildAlgorithmChapter, buildAlgorithmLesson } from '../content/conversational-skills/en/level-7-chapter-2/build';
import { spotlightEpisodes } from '../content/conversational-skills/en/level-7-chapter-1/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints, checkpointPrompt, summarizeCheckpointEvidence } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildAlgorithmChapter();
const lesson = (n: number) => lessons.find(l => l.lessonNumber === n);

test('Algorithm chapter uses eight English-only Level 7 drafts at the owner TOEIC band', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  const expressions = new Set<string>();
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = algorithmEpisodes[n], step = l.learnData.steps[0];
    expect([l.id, l.level, l.chapter, l.status]).toEqual([algorithmId(n), 7, 2, 'draft']);
    expect(l.authoringLanguageTarget).toBe('TOEIC 550-780'); expect(l.supportLanguage).toBe('en');
    expect(l.chapterName).toBe('The Algorithm Never Sleeps'); expect(l.storyData.storyTitle).toBe('Beyond the Spotlight');
    expect(conversationalLessonErrors(l)).toEqual([]);
    expect(JSON.stringify(l)).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(l.goalTextJp).toBe(''); expect(wordCount(e.goal)).toBeLessThanOrEqual(15); expect(wordCount(e.intro)).toBeLessThanOrEqual(90);
    expect(step.stepType).toBe('expressions'); expect(step.stepName).toBe('STEP A: EXPRESSIONS');
    expect(step.vocabularyItems).toBeUndefined(); expect(step.expressionItems).toHaveLength(4);
    step.expressionItems.forEach((item: any, i: number) => {
      const [phrase, meaning, example] = e.expressions[i]!;
      expect(item.definitionLine).toBe(`<strong>${phrase}</strong> ${meaning}`);
      expect(item.exampleSentence).toBe(`<em>${example}</em>`); expect(example).toContain('<strong>'); expressions.add(phrase);
    });
  }
  expect(expressions.size).toBe(32);
});

test('objective-first guides retain plain Apply situations, separate questions and fixed feedback', () => {
  for (const n of storyLessonNumbers) {
    const l = lesson(n), e = algorithmEpisodes[n], step = l.learnData.steps[0];
    expect(l.introductionData.lessonGoalSteps[0].script).toStartWith('Our lesson objective today is to');
    expect(l.introductionData.lessonGoalSteps[1].script).toBe(`Here is our situation. ${e.intro}`);
    expect(l.applyData.situationText).not.toMatch(/<[^>]+>/);
    expect(l.applyData.tutorSteps[1].questions).toEqual(e.apply.questions.map(([question, answer]) => ({ question, answer })));
    expect(step.tutorSteps).toHaveLength(5); expect(step.discussionPart.tutorSteps).toHaveLength(5);
    expect(l.applyData.triviaTutorSteps).toHaveLength(4); expect(l.missionData.grammarTipItems).toHaveLength(5);
    expect(l.missionData2.topics).toHaveLength(3); expect(l.feedbackData.tutorSteps).toHaveLength(6);
    expect(l.feedbackData.categories.map((c: any) => c.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    expect(l.feedbackData.rubricLevels.map((r: any) => r.score)).toEqual([4, 3, 2, 1]);
  }
});

test('only Step B teaches pronunciation using linking or groups and exact partial bold stress', () => {
  for (const l of lessons) {
    const step = l.learnData.steps[0], p = l.stepBData.pronunciation;
    expect(step.pronunciationPart).toBeUndefined(); expect(l.stepBData.stepType).toBe('pronunciation');
    expect(step.discussionPart.tutorSteps.at(-1).script).toContain('Step B Pronunciation');
    expect(p.phrases).toHaveLength(2); expect(p.tutorSteps).toHaveLength(6);
    expect(JSON.stringify([l.learnData, l.stepBData])).not.toMatch(/Part III|reading cues|\bIPA\b|accents?/i);
    for (const p of l.stepBData.pronunciation.phrases) {
      expect(p.pronunciationGuide).toMatch(/^\/ .+[|‿].+ \/$/);
      const bold = [...p.exampleSentence.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m: any) => m[1]);
      expect(bold.length).toBeGreaterThan(0); expect(bold.join('')).not.toMatch(/[|‿]/);
      expect(bold.join('').length).toBeLessThan(p.exampleSentence.replace(/<[^>]*>/g, '').length);
    }
  }
});

test('direct roles and natural tutor-first turns stay within the speaking budget', () => {
  for (const n of storyLessonNumbers) {
    const e = algorithmEpisodes[n], l = lesson(n), guide = l.missionData.tutorSteps[l.skill === 'speaking' ? 1 : 2];
    expect(l.missionData.situation).toMatch(/^You are (Maya|Kai|Natsumi|Luis)\. Your tutor is /);
    expect(guide.instruction).toContain('tutor speaks first');
    expect(guide.scripts[0].text).toContain(`I'll be ${e.mission.roles[0]}. Please be ${e.mission.roles[1]}`);
    expect(guide.scripts[1].text).toBe(`1. ${e.mission.lines[0]}`);
    expect(e.mission.lines[0]).not.toMatch(/asks:|Tell me one thing|What can you ask/);
    if (e.skill === 'speaking') {
      expect(l.applyData.dialogueLines).toHaveLength(10);
      e.apply.dialogue!.forEach(([speaker], i) => expect(speaker).toBe(e.apply.roles![i % 2]!));
      expect(wordCount(e.apply.dialogue!.map(v => v[1]).join(' '))).toBeLessThanOrEqual(180);
    }
  }
});

test('distinct correction recordings stay short and tutor-only, while both reading missions have fresh visible notes', () => {
  const l = lesson(2), a = l.applyData.tutorSteps[0].listeningScript, b = l.missionData.tutorSteps[1].listeningScript;
  expect(a).not.toBe(b); for (const text of [a, b]) expect(wordCount(text)).toBeLessThanOrEqual(110);
  expect(a).toContain('venue’s permission'); expect(a).toContain('Some people have apologised'); expect(a).toContain('others still defend');
  expect(b).toContain('venue approved publication'); expect(b).toContain('without claiming that everyone now agrees');
  expect(l.applyData.readingText).toBe(''); expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.listeningScript).toBeUndefined(); expect(l.missionData.readingPassage).toBeUndefined();
  for (const n of [3, 8]) {
    const l = lesson(n), mission = l.missionData.readingPassage.blocks[0].content;
    expect(mission).not.toBe(l.applyData.readingText); expect(wordCount(mission)).toBeLessThanOrEqual(220);
    expect(wordCount(l.applyData.readingText)).toBeLessThanOrEqual(220);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  expect(lesson(3).missionData.readingPassage.blocks[0].content).toContain('agency did not request these posts');
  expect(lesson(8).missionData.readingPassage.blocks[0].content).toContain('not footage already filmed or published');
});

test('response chronology connects the unresolved Chapter 1 hold to permission, publication and later interview', () => {
  expect(lesson(1).storyData.previousSummary).toBe(spotlightEpisodes[9].closing);
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(algorithmEpisodes[storyLessonNumbers[i - 1]!].closing);
  expect(algorithmEpisodes[1].closing).toContain('Publication has not happened yet');
  expect(algorithmEpisodes[2].closing).toContain('With venue permission');
  expect(algorithmEpisodes[4].apply.dialogue![4]![1]).toContain('I will ask about it');
  expect(algorithmEpisodes[4].closing).toContain('before the interview takes place');
  expect(algorithmEpisodes[7].closing).toContain('Publication, the audience response and the showcase decision are still to come');
  expect(algorithmEpisodes[8].apply.text).toContain('organisers reviewed the complete performance footage and the team’s response');
  expect(algorithmEpisodes[8].mission.text).toContain('Natsumi needs to communicate that confirmation');
});

test('fan accounts do not become unanimous approval, and repeated posts do not become proven coordination', () => {
  expect(algorithmEpisodes[3].apply.text).toContain('without being asked');
  expect(algorithmEpisodes[3].apply.text).toContain('without encouraging attacks on critics');
  expect(algorithmEpisodes[3].mission.text).toContain('not evidence about who created that edit');
  const e = algorithmEpisodes[6];
  expect(e.apply.dialogue![1]![1]).toContain('almost identical captions');
  expect(e.apply.dialogue![4]![1]).toContain('automated reposting or people copying popular captions');
  expect(e.apply.dialogue![6]![1]).toContain('not have enough evidence for a public accusation');
  expect(e.mission.evidence).toContain('no current platform-specific procedure required');
  expect(e.closing).toContain('cause and any platform response remain unknown');
});

test('showcase and release precede business interest but no contract terms or signed deal are invented', () => {
  const e = algorithmEpisodes[9];
  expect(e.intro).toContain('A month later'); expect(e.intro).toContain('officially released earlier that week');
  expect(e.apply.dialogue![0]![1]).toContain('possible recording agreement');
  expect(e.apply.dialogue![4]![1]).toContain('No agreement is confirmed');
  expect(e.apply.dialogue![6]![1]).toContain('expect in return');
  expect(e.mission.situation).toContain('No terms or signed agreement have been confirmed');
  expect(e.closing).toContain('decision remains open');
  const facing = JSON.stringify(lessons.map(({ storyData, ...rest }) => rest));
  expect(facing).not.toMatch(/\b(?:boyfriend|girlfriend|romantic|dating)\b|Kamo House|Eastbridge|Mrs\. Takeda|API_KEY|createAgent/);
});

test('exercise keys match their options and real-error tracking stays available', () => {
  for (const n of storyLessonNumbers) {
    const e = algorithmEpisodes[n], l = lesson(n);
    expect(l.exerciseData.chooseItems).toHaveLength(6); expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.answers.map((v: any) => v.text)).toEqual(e.choose.map(v => v[1]));
    e.choose.forEach(([sentence, answer]) => expect(sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ') || []).toContain(answer));
    expect(l.exerciseData.stepBTutorSteps[1].answerKey.map((v: any) => v.text)).toEqual(e.choices.map((v, i) => `${i + 1}. ${v[3]} - ${v[v[3] === 'A' ? 1 : 2]}`));
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
  }
});

test('saved identity, artwork, status, notes and fixed feedback survive compilation without mutating inputs', () => {
  const previous = { id: 'keep-id', status: 'published', backgroundImage: 'keep.webp', studentNotes: { text: 'keep' },
    introductionData: { introImage: 'intro.webp' }, applyData: { situationImage: 'apply.webp' }, missionData: { image: 'mission.webp', listeningScript: 'obsolete' },
    feedbackData: { ...lesson(1).feedbackData, categories: [{ title: 'KEEP' }] } };
  const original = JSON.stringify(previous), l = buildAlgorithmLesson(1, previous);
  expect(l.id).toBe('keep-id'); expect(l.status).toBe('published'); expect(l.studentNotes).toEqual(previous.studentNotes);
  expect(l.backgroundImage).toBe('keep.webp'); expect(l.introductionData.introImage).toBe('intro.webp');
  expect(l.applyData.situationImage).toBe('apply.webp'); expect(l.missionData.image).toBe('mission.webp');
  expect(l.feedbackData.categories).toEqual([{ title: 'KEEP' }]); expect(JSON.stringify(previous)).toBe(original);
  expect(l.missionData.listeningScript).toBeUndefined();
});

test('dynamic checkpoints use the new chapter and authoring stays local with guarded persistence', () => {
  const available = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(available.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L7-C2-5-review', 'conversational-skills-L7-C2-10-review']);
  const prompt = checkpointPrompt(lessons.slice(4), summarizeCheckpointEvidence([], []));
  expect(prompt).toContain('Level 7, TOEIC 550-780'); expect(prompt).toContain('notice a pattern');
  expect(prompt).toContain('The captions are SIMilar'); expect(prompt).toContain('Do not identify or invent student weaknesses');
  const writer = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(writer).toContain("'7:2': { title: 'The Algorithm Never Sleeps'");
  expect(writer).toContain('Concurrent edit detected'); expect(writer).toContain('Full record read-back mismatch');
  const source = readFileSync(new URL('../content/conversational-skills/en/level-7-chapter-2/build.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/createAgent|\.generate\(|fetch\(|API_KEY/);
});
