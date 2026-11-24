import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildEverydayChapter, buildEverydayLesson, chapter3Episodes, chapter3Id } from '../content/conversational-skills/ja/level-3-chapter-3/build';
import { buildChapter } from '../content/conversational-skills/ja/level-3-chapter-1/build';
import { buildKyotoChapter } from '../content/conversational-skills/ja/level-3-chapter-2/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { directRoleplayCopy } from '../content/conversational-skills/ja/direct-roleplay-copy';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildEverydayChapter();
test('Chapter 3 maps the eight supplied episodes to the standard slots and skills', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.lessonName)).toEqual(['A Date or Just Coffee?', 'A Busy Monday', 'Trouble at the Cafe', 'Dinner at Kamo House', 'A Small Misunderstanding', 'Nao\'s Big Opportunity', 'An Unexpected Apology', 'Something Worth Celebrating']);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const l of lessons) {
    expect(l.id).toBe(chapter3Id(l.lessonNumber));
    expect(l.chapter).toBe(3);
    expect(l.level).toBe(3);
    expect(l.chapterName).toBe('Everyday Life & Unexpected Moments');
    expect(l.status).toBe('draft');
    expect(conversationalLessonErrors(l)).toEqual([]);
    expect(l.backgroundImage).toBe('');
    expect(l.storyData.characters.map((c: any) => c.name)).toEqual(['Emma', 'Claire', 'Leo', 'Nao', 'Aya']);
    expect(JSON.stringify(l)).not.toMatch(/https?:|Gojo Art Room|old poster|missing cups|Yuki|[\uac00-\ud7af]/u);
  }
});
test('all roleplay assignments across three chapters are direct and omit alternate-character disclaimers', () => {
  for (const l of [...buildChapter('https://api.fluentxverse.com').filter(l => ![5, 10].includes(l.lessonNumber)), ...buildKyotoChapter(), ...lessons] as any[]) {
    const all = JSON.stringify(l);
    expect(all).not.toMatch(/You may play|invented adult character|No personal or romantic|personal romantic disclosures|Please be Emma or|do not demand emotional disclosure|Do not require flirtation/);
    expect(l.missionData.situation).toMatch(/You are Emma|You are Leo|You are the shop assistant/);
  }
  expect(lessons.every(l => l.missionData.situation.startsWith('You are Emma'))).toBe(true);
});
test('editorial copy correction is idempotent and preserves unrelated objects, artwork and evidence', () => {
  const before = { id: 'keep-id', status: 'published', image: 'https://example.com/asset.webp', notes: 'Unchanged assessment evidence.', content: 'Your tutor is Leo, inviting you to a friendly outing. You may play Emma or use an invented adult character. Decide whether to accept, suggest another day, or politely decline. No personal or romantic information is needed.', jp: '講師は気軽な外出に誘うレオ役です。あなたはエマ役でも、架空の大人の人物でもかまいません。応じるか、別の日を提案するか、丁寧に断るかを選びましょう。個人的な情報や恋愛の話は必要ありません。', spaced: '  preserve unrelated spacing  ' };
  const frozen = JSON.stringify(before);
  const after = directRoleplayCopy(before);
  expect(after.content).toBe('You are Emma. Your tutor is Leo. You are planning another outing together.');
  expect(after.jp).toBe('あなたはエマ役、講師はレオ役です。二人で次の外出を計画しています。');
  for (const key of ['id', 'status', 'image', 'notes', 'spaced'] as const) expect(after[key]).toBe(before[key]);
  expect(JSON.stringify(before)).toBe(frozen);
  expect(directRoleplayCopy(after)).toEqual(after);
});
test('standard guides, bilingual support and exercise keys are complete in all eight lessons', () => {
  for (const l of lessons) {
    const learn = l.learnData.steps[0];
    expect(l.introductionData.lessonGoalSteps).toHaveLength(4);
    expect(learn.vocabularyItems).toHaveLength(6);
    expect(learn.tutorSteps).toHaveLength(5);
    expect(learn.discussionPart.tutorSteps).toHaveLength(5);
    expect(learn.pronunciationPart.tutorSteps).toHaveLength(5);
    expect(l.stepBData.grammarTip.tutorSteps).toHaveLength(2);
    expect(l.applyData.tutorSteps).toHaveLength(2);
    expect(l.applyData.triviaTutorSteps).toHaveLength(4);
    expect(l.missionData.tutorSteps).toHaveLength(l.skill === 'speaking' ? 3 : 4);
    expect(l.missionData2.topics).toHaveLength(3);
    expect(l.feedbackData.tutorSteps).toHaveLength(6);
    expect(l.feedbackData.rubricLevels.map((r: any) => r.score)).toEqual([4, 3, 2, 1]);
    expect(l.feedbackData.categories.map((c: any) => c.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.answers).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.stepBTutorSteps[1].answerKey).toHaveLength(4);
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('incorrect');
    for (const text of [l.goalTextJp, l.introductionData.introTexts[1].text, l.applyData.situationTranslation, l.missionData.situationTranslation, l.missionData.instructionTranslation, ...learn.vocabularyItems.map((v: any) => v.translation)]) expect(text).toMatch(/[ぁ-んァ-ン]/u);
    for (const [sentence, answer] of chapter3Episodes[l.lessonNumber as 1].choose) expect(requireDefined(sentence.match(/\(([^)]+)\)/)?.[1], "sentence.match(/\\(([^)]+)\\)/)?.[1]").split(' / ')).toContain(answer);
  }
});
test('speaking remains short, tutor-first dialogue and listening evidence remains private', () => {
  for (const l of lessons.filter(l => l.skill === 'speaking')) {
    const lines = l.applyData.dialogueLines;
    expect(lines).toHaveLength(10);
    expect(lines.map((line: any) => line.text).join(' ').split(/\s+/).length).toBeLessThan(160);
    for (let i = 1; i < lines.length; i++) expect(lines[i].speaker).not.toBe(lines[i - 1].speaker);
    expect(l.missionData.tutorSteps[1].instruction).toContain('tutor speaks first');
    expect(l.missionData.tutorSteps[1].scripts[1].text).toStartWith('1.');
    expect(l.missionData.instruction).not.toMatch(/monologue|90.second|uninterrupted/);
  }
  const listening = lessons[1];
  expect(listening.applyData.dialogueLines).toEqual([]);
  expect(listening.applyData.readingText).toBe('');
  expect(listening.missionData.readingPassage).toBeUndefined();
  expect(listening.missionData.listeningScript).toBeUndefined();
  for (const script of [listening.applyData.tutorSteps[0].listeningScript, listening.missionData.tutorSteps[1].listeningScript]) expect(script.replace(/<[^>]*>/g, '').split(/\s+/).length).toBeLessThan(80);
});
test('the interpersonal conflict resolves the facts without blaming Leo for a work lunch', () => {
  expect(lessons[4].applyData.dialogueLines.map((line: any) => line.text).join(' ')).toContain('I thought they might be dating');
  expect(lessons[6].applyData.readingText).toContain('She works with me');
  expect(lessons[6].applyData.readingText).toContain('sorry for going quiet');
  expect(lessons[6].applyData.readingText).toContain('ask rather than guess');
  expect(lessons[6].applyData.readingText).not.toContain('Leo:</strong> I\'m sorry');
  expect(lessons[5].storyData.currentEpisodeSummary).toContain('gallery exhibition');
  expect(lessons[2].storyData.currentEpisodeSummary).toContain('short-staffed');
  expect(lessons[7].storyData.currentEpisodeSummary).toContain('Nao\'s gallery exhibition is a success');
});
test('reading challenges supply fresh evidence and the schedule stays internally consistent', () => {
  for (const l of lessons.filter(l => l.skill === 'reading')) {
    expect(l.missionData.readingPassage.blocks[0].content).not.toBe(l.applyData.readingText);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
    expect(l.missionData.tutorSteps[2].instruction).toContain('tutor speaks first');
  }
  const labels = lessons[5].missionData;
  expect(labels.situation).toContain('Thursday after 6 p.m.');
  expect(labels.situation).toContain('Friday');
  const messages = lessons[6].missionData.readingPassage.blocks[0].content;
  expect(messages).toContain('Thursday');
  expect(messages).toContain('Saturday');
  expect(messages).toContain('pack until six');
  expect(messages).toContain('Kamo House at 6:30');
  expect(lessons[7].missionData.situation).toContain('next Sunday after 5 p.m.');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(chapter3Episodes[requireDefined(storyLessonNumbers[i - 1], "storyLessonNumbers[i - 1]")].closing);
});
test('checkpoint slots stay dynamic and existing identity and fixed feedback remain unchanged', () => {
  const slots = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' }))).filter(l => [5, 10].includes(l.lessonNumber));
  expect(slots.map(l => l.id)).toEqual(['conversational-skills-L3-C3-5-review', 'conversational-skills-L3-C3-10-review']);
  const previous = { id: 'existing-id', status: 'draft', feedbackData: { ...lessons[0].feedbackData, categories: [{ title: 'unchanged' }] } };
  expect(buildEverydayLesson(1, previous).id).toBe('existing-id');
  expect(buildEverydayLesson(1, previous).feedbackData.categories).toEqual(previous.feedbackData.categories);
});
