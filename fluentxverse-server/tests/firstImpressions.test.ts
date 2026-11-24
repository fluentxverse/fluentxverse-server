import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildFirstImpressionsChapter, buildFirstImpressionsLesson, firstImpressionsEpisodes, firstImpressionsId } from '../content/conversational-skills/ja/level-5-chapter-1/build';
import { buildWhereWeBelongChapter } from '../content/conversational-skills/ja/level-4-chapter-5/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { languageEpisodeErrors, wordCount } from '../content/conversational-skills/ja/language-validation';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildFirstImpressionsChapter();
test('First Impressions uses the revised no-romance reference and the agreed slots and skills', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.lessonName)).toEqual(['Welcome to Eastbridge', 'The Big Announcement', 'Different Ways of Thinking', 'Beyond the Office', 'A Question of Responsibility', 'Handle with Care', 'A Difficult Conversation', 'The Unexpected File']);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const l of lessons) {
    expect(l.id).toBe(firstImpressionsId(l.lessonNumber));
    expect([l.level, l.chapter, l.status, l.chapterName, l.levelBadge]).toEqual([5, 1, 'draft', 'First Impressions', 'ELEMENTARY']);
    expect(conversationalLessonErrors(l)).toEqual([]);
    expect(languageEpisodeErrors(firstImpressionsEpisodes[l.lessonNumber as 1], 5, l.skill)).toEqual([]);
  }
});
test('a separate Tokyo cast starts and continues without invented Kyoto connections', () => {
  expect(lessons[0].storyData.previousSummary).toContain('The Kamo House story is complete');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(firstImpressionsEpisodes[storyLessonNumbers[i - 1]!].closing);
  for (const l of lessons) {
    expect(l.storyData.storyTitle).toBe('Tokyo After Hours');
    expect(l.storyData.characters.map((c: any) => c.name).sort()).toEqual(['Daichi', 'Ethan', 'Mika Tanaka', 'Soo-jin']);
    expect(l.missionData.situation).toMatch(/^You are Mika/);
    expect(l.missionData.situation).not.toMatch(/Emma|Ren|Claire|Nao|Leo/);
  }
});
test('Level 5 follows the owner score band and short functional language, not reference CEFR labels', () => {
  for (const l of lessons) {
    expect(l.authoringLanguageTarget).toBe('TOEIC 225-545');
    expect(l.goalTextEn).toMatch(/^I can /);
    expect(wordCount(l.goalTextEn)).toBeLessThanOrEqual(15);
    expect(l.storyData.storyNotes).toContain('not a CEFR equivalence');
    const p = l.learnData.steps[0].pronunciationPart;
    expect([p.leftColumn.soundSymbol, p.rightColumn.soundSymbol]).toEqual(['/s/', '/z/']);
    expect(p.leftColumn.words.map((w: any) => w.word)).toEqual(['sip', 'price', 'bus']);
    expect(p.rightColumn.words.map((w: any) => w.word)).toEqual(['zip', 'prize', 'buzz']);
    expect(l.missionData.grammarTipItems.length).toBeGreaterThanOrEqual(5);
  }
});
test('Japanese support, vocabulary, standard tutor guides and fixed feedback are complete', () => {
  for (const l of lessons) {
    const learn = l.learnData.steps[0];
    expect(l.introductionData.lessonGoalSteps).toHaveLength(4);
    expect(learn.vocabularyItems).toHaveLength(6);
    expect(learn.tutorSteps).toHaveLength(5);
    expect(learn.discussionPart.tutorSteps).toHaveLength(5);
    expect(learn.pronunciationPart.tutorSteps).toHaveLength(5);
    expect(l.stepBData.grammarTip.explanations).toHaveLength(2);
    expect(l.stepBData.grammarTip.tutorSteps).toHaveLength(2);
    expect(l.applyData.tutorSteps).toHaveLength(2);
    expect(l.applyData.triviaTutorSteps).toHaveLength(4);
    expect(l.missionData.tutorSteps).toHaveLength(l.skill === 'speaking' ? 3 : 4);
    expect(l.missionData2.topics).toHaveLength(3);
    expect(l.feedbackData.tutorSteps).toHaveLength(6);
    expect(l.feedbackData.categories.map((c: any) => c.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    expect(l.feedbackData.rubricLevels.map((r: any) => r.score)).toEqual([4, 3, 2, 1]);
    for (const value of [l.goalTextJp, l.introductionData.introTexts[1].text, l.applyData.situationTranslation, l.applyData.triviaTranslation, l.missionData.situationTranslation, l.missionData.instructionTranslation, ...learn.vocabularyItems.map((v: any) => v.translation)]) expect(value).toMatch(/[ぁ-んァ-ン\p{Script=Han}]/u);
  }
});
test('speaking models are ten short alternating tutor-first turns, without romantic questions', () => {
  for (const l of lessons.filter(l => l.skill === 'speaking')) {
    const lines = l.applyData.dialogueLines;
    expect(lines).toHaveLength(10);
    expect(wordCount(lines.map((v: any) => v.text).join(' '))).toBeLessThanOrEqual(115);
    lines.forEach((line: any, i: number) => expect(line.speaker).toBe(firstImpressionsEpisodes[l.lessonNumber as 1].apply.roles![i % 2]));
    expect(l.missionData.tutorSteps[1].instruction).toContain('tutor speaks first');
  }
  const learnerContent = lessons.map(({ storyData, ...content }) => content);
  expect(JSON.stringify(learnerContent)).not.toMatch(/\b(?:dating|boyfriend|girlfriend|romantic|monologue)\b|You may play|invented adult|No personal or romantic/i);
});
test('short distinct listening scripts are tutor-only and keep both hotel campaign goals', () => {
  const l = lessons[1];
  const scripts = [l.applyData.tutorSteps[0].listeningScript, l.missionData.tutorSteps[1].listeningScript];
  scripts.forEach(text => expect(wordCount(text)).toBeLessThanOrEqual(70));
  expect(scripts[0]).not.toBe(scripts[1]);
  expect(scripts[0]).toContain('international');
  expect(scripts[0]).toContain('high-quality');
  expect(scripts[1]).toContain('tomorrow at ten');
  expect(l.applyData.readingText).toBe('');
  expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.listeningScript).toBeUndefined();
  expect(l.missionData.readingPassage).toBeUndefined();
});
test('six/four exercises retain matching keys and actual mistake tracking', () => {
  for (const l of lessons) {
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.answers).toHaveLength(6);
    expect(l.exerciseData.tutorSteps[0].answerKey).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.stepBTutorSteps[1].answerKey).toHaveLength(4);
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
    for (const [sentence, answer] of firstImpressionsEpisodes[l.lessonNumber as 1].choose) expect(sentence.match(/\(([^)]+)\)/)?.[1]?.split(' / ') || []).toContain(answer);
  }
});
test('different audience ideas and fresh review note remain simple and evidence-based', () => {
  const l = lessons[2];
  expect(l.applyData.readingText.toLowerCase()).toContain('younger');
  expect(l.applyData.readingText).toContain('business');
  const fresh = l.missionData.readingPassage.blocks[0].content;
  expect(fresh).not.toBe(l.applyData.readingText);
  expect(fresh).toContain('three');
  expect(fresh).toContain('Do not publish');
});
test('the dinner is about moving cities and coworker friendship', () => {
  const l = lessons[3];
  expect(l.missionData.situation).toContain('Osaka');
  expect(l.missionData.situation).toContain('Seoul');
  expect(l.missionData.situation).toContain('Bristol');
  expect(l.applyData.dialogueLines.map((v: any) => v.text).join(' ')).toContain('Bristol');
});
test('the team checks responsibilities rather than assuming an absent person agreed', () => {
  const l = lessons[4];
  expect(l.missionData.situation).toContain('two weeks');
  expect(l.missionData.situation).toContain('needs checking');
  expect(l.missionData.tutorSteps[1].tips[1].text).toContain('instead of assuming');
  expect(l.storyData.nextEpisodeHook).toContain('agrees');
});
test('the older report is kept for reference and later missing, not an attachment error', () => {
  const l = lessons[5];
  expect(l.applyData.dialogueLines.map((v: any) => v.text).join(' ')).toContain('keep it for reference');
  expect(l.storyData.nextEpisodeHook).toContain('disappeared');
  expect(l.missionData.tutorSteps[1].tips[1].text).toContain('does not know who moved it');
  expect(JSON.stringify(firstImpressionsEpisodes)).not.toMatch(/\battachment\b|hotel_proposal_v2|had been deleted/i);
});
test('partial argument and new work note do not establish a leak or resolve the mystery', () => {
  const l = lessons[6];
  expect(l.applyData.readingText).toContain('does not hear');
  const fresh = l.missionData.readingPassage.blocks[0].content;
  expect(fresh).not.toBe(l.applyData.readingText);
  expect(fresh).toContain('room B at three this afternoon');
  expect(fresh).toContain('Do not repeat a guess as a fact');
});
test('Northstar and old figures are visible in the printer roleplay without identifying a culprit', () => {
  const l = lessons[7];
  expect(l.missionData.situation).toContain("old report's figures");
  expect(l.missionData.situation).toContain('Northstar Media');
  expect(l.missionData.situation).toContain('do not know who printed');
  expect(l.applyData.dialogueLines[8].text).toContain('Close the door');
  expect(l.missionData.tutorSteps[1].tips[1].text).toContain('not an explanation or proof of guilt');
});
test('guarded authoring includes Tokyo topic and preserves unrelated metadata', () => {
  const source = readFileSync(new URL('../../scripts/apply-exploring-kyoto.ts', import.meta.url), 'utf8');
  expect(source).toContain("'5:1': { title: 'First Impressions'");
  expect(source).toContain("mainTopic: 'Tokyo After Hours'");
  expect(source).toContain('Concurrent edit detected');
  expect(source).toContain('Level topic read-back mismatch');
  expect(source).toContain('Unrelated level metadata changed');
});
test('existing identity and feedback are retained, artwork absent, checkpoints dynamic', () => {
  const before = buildWhereWeBelongChapter();
  buildFirstImpressionsChapter();
  expect(buildWhereWeBelongChapter()).toEqual(before);
  for (const l of lessons) expect(JSON.stringify(l)).not.toMatch(/https?:\/\/[^" ]+\.(?:png|webp|jpe?g)/i);
  const previous = { id: 'keep-id', status: 'draft', feedbackData: { ...lessons[0].feedbackData, categories: [{ title: 'KEEP' }] } };
  const copy = JSON.stringify(previous);
  const l = buildFirstImpressionsLesson(1, previous);
  expect(l.id).toBe(previous.id);
  expect(l.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(JSON.stringify(previous)).toBe(copy);
  const checkpoints = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(checkpoints.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L5-C1-5-review', 'conversational-skills-L5-C1-10-review']);
});
