import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildDreamsInMotionChapter, buildDreamsInMotionLesson, dreamsInMotionEpisodes, dreamsInMotionId } from '../content/conversational-skills/ja/level-4-chapter-4/build';
import { buildLittleCloserChapter } from '../content/conversational-skills/ja/level-4-chapter-3/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildDreamsInMotionChapter();
test('Dreams in Motion fills Level 4 Chapter 4 with eight reference episodes and the fixed skill pattern', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.lessonName)).toEqual(['Bigger Dreams', 'A Plan on Paper', 'Money Matters', 'A Day in Uji', 'A Scheduling Disaster', 'The Big Presentation', 'The Unexpected Downpour', 'Doors Are Opening']);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const l of lessons) {
    expect(l.id).toBe(dreamsInMotionId(l.lessonNumber));
    expect(l.level).toBe(4);
    expect(l.chapter).toBe(4);
    expect(l.chapterName).toBe('Dreams in Motion');
    expect(l.status).toBe('draft');
    expect(conversationalLessonErrors(l)).toEqual([]);
  }
});
test('continuity develops the monthly market and all five characters without restoring the removed incident', () => {
  expect(JSON.stringify(lessons)).not.toMatch(/\bkiss(?:ed|es|ing)?\b|キス|口づけ|invented adult character|You may play|No personal or romantic/i);
  expect(lessons[0].storyData.previousSummary).toContain('Claire committed to monthly events');
  expect(lessons[0].storyData.previousSummary).toContain('Fukuoka visit remained an unbooked idea');
  expect(lessons[0].storyData.currentEpisodeSummary).toContain('monthly event to grow');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(dreamsInMotionEpisodes[requireDefined(storyLessonNumbers[i - 1], "storyLessonNumbers[i - 1]")].closing);
  for (const l of lessons) expect(l.storyData.characters.map((c: any) => c.name).sort()).toEqual(['Claire', 'Emma', 'Leo', 'Nao', 'Ren']);
  expect(lessons[1].storyData.currentEpisodeSummary).toContain('Kamo Collective');
  expect(lessons[7].storyData.nextEpisodeHook).not.toContain('reference outline');
});
test('direct roles and Japanese support accompany the standard tutor guides and fixed feedback', () => {
  expect(lessons.map(l => l.missionData.situation.match(/^You are (\w+)/)?.[1])).toEqual(['Leo', 'Emma', 'Emma', 'Leo', 'Nao', 'Emma', 'Ren', 'Emma']);
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
    expect(l.feedbackData.rubricLevels.map((r: any) => r.score)).toEqual([4, 3, 2, 1]);
    expect(l.feedbackData.categories.map((c: any) => c.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    for (const value of [l.goalTextJp, l.introductionData.introTexts[1].text, l.applyData.situationTranslation, l.applyData.triviaTranslation, l.missionData.situationTranslation, l.missionData.instructionTranslation, ...learn.vocabularyItems.map((v: any) => v.translation)]) expect(value).toMatch(/[ぁ-んァ-ン]/u);
    expect(JSON.stringify(l)).not.toMatch(/[\uac00-\ud7af]/u);
  }
});
test('speaking including the presentation is short alternating dialogue, not a monologue', () => {
  for (const l of lessons.filter(l => l.skill === 'speaking')) {
    const lines = l.applyData.dialogueLines;
    expect(lines).toHaveLength(10);
    expect(lines.map((line: any) => line.text).join(' ').split(/\s+/).length).toBeLessThan(165);
    for (let i = 1; i < lines.length; i++) expect(lines[i].speaker).not.toBe(lines[i - 1].speaker);
    expect(lines[0].speaker).toBe(dreamsInMotionEpisodes[l.lessonNumber as 1].apply.roles![0]);
    expect(l.missionData.tutorSteps[1].instruction).toContain('tutor speaks first');
    expect(l.missionData.tutorSteps[1].scripts[1].text).toStartWith('1.');
  }
  const presentation = lessons[5];
  expect(presentation.missionData.tutorSteps[1].scripts.map((s: any) => s.text).join(' ')).toContain('what is your proposal');
  expect(presentation.missionData.tutorSteps[1].tips[1].text).toContain('dialogue');
});
test('listening has distinct short private scripts and separates first ideas from publication', () => {
  const l = lessons[1];
  expect(l.applyData.readingText).toBe('');
  expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.readingPassage).toBeUndefined();
  expect(l.missionData.listeningScript).toBeUndefined();
  const scripts = [l.applyData.tutorSteps[0].listeningScript, l.missionData.tutorSteps[1].listeningScript];
  for (const text of scripts) expect(text.replace(/<[^>]*>/g, '').split(/\s+/).length).toBeLessThan(80);
  expect(scripts[0]).not.toBe(scripts[1]);
  expect(scripts[0]).toContain('Wednesday evening');
  expect(scripts[1]).toContain('Friday at four');
  expect(scripts[1]).toContain('Do not post it until she confirms');
});
test('six Step A and four Step B items have complete keys and retain actual-error tracking', () => {
  for (const l of lessons) {
    expect(l.exerciseData.stepAType).toBe('choose');
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.answers).toHaveLength(6);
    expect(l.exerciseData.tutorSteps[0].answerKey).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.stepBTutorSteps[1].answerKey).toHaveLength(4);
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
    for (const [sentence, answer] of dreamsInMotionEpisodes[l.lessonNumber as 1].choose) expect(requireDefined(sentence.match(/\(([^)]+)\)/)?.[1], "sentence.match(/\\(([^)]+)\\)/)?.[1]").split(' / ')).toContain(answer);
    for (const item of dreamsInMotionEpisodes[l.lessonNumber as 1].choices) expect(item[item[3] === 'A' ? 1 : 2]).not.toBe(item[item[3] === 'A' ? 2 : 1]);
  }
});
test('reading uses new evidence and the two budget calculations and cash limitations agree', () => {
  for (const l of [lessons[2], lessons[6]]) {
    expect(l.missionData.readingPassage.blocks[0].content).not.toBe(l.applyData.readingText);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  const budget = lessons[2];
  expect(18000 + 8000 + 20000).toBe(46000);
  expect(18000 + 8000 + 8000).toBe(34000);
  expect(budget.applyData.readingText).toContain('Shortfall: ¥6,000');
  expect(budget.applyData.readingText).toContain('Reserve: ¥6,000');
  const revised = budget.missionData.readingPassage.blocks[0].content;
  expect(16000 + 6000 + 8000 + 5000).toBe(35000);
  expect(40000 - 35000).toBe(5000);
  expect(revised).toContain('Total: ¥35,000. Reserve: ¥5,000');
  expect(revised).toContain('including delivery');
  expect(revised).toContain('no payment has arrived');
  expect(revised).toContain('not increase today\'s cash');
});
test('the Saturday conflict leads to Sunday and the rain update changes layout rather than cancelling the event', () => {
  expect(lessons[1].storyData.currentEpisodeSummary).toContain('Saturday in three weeks');
  expect(lessons[4].missionData.situation).toContain('Saturday at noon');
  expect(lessons[4].storyData.nextEpisodeHook).toContain('confirms the Sunday change');
  expect(lessons[5].applyData.dialogueLines.map((l: any) => l.text).join(' ')).toContain('changed Saturday to Sunday');
  const rain = lessons[6];
  expect(rain.applyData.readingText).toContain('Sunday, 9:40');
  expect(rain.applyData.readingText).toContain('Only four display tables fit');
  expect(rain.applyData.readingText).toContain('Do not move the full outdoor stalls inside');
  const update = rain.missionData.readingPassage.blocks[0].content;
  expect(update).toContain('will not reopen today');
  expect(update).toContain('back wall, not by the window');
  expect(update).toContain('noon at shared table A');
  expect(update).toContain('from 1 p.m.');
  expect(update).toContain('not proof it has already been paid');
});
test('Seoul remains a shortlist opportunity and the kitchen offer does not become an opened bakery', () => {
  const last = lessons[7];
  expect(last.storyData.currentEpisodeSummary).toContain('hours and costs are not final');
  expect(last.storyData.currentEpisodeSummary).toContain('project has not been awarded');
  expect(last.missionData.situation).toContain('No project award or travel booking is confirmed');
  expect(last.applyData.dialogueLines.map((l: any) => l.text).join(' ')).toContain('No trip is booked');
  expect(last.missionData.tutorSteps[1].tips[1].text).toContain('brief/format/deadline');
  expect(last.storyData.nextEpisodeHook).toContain('still need confirmation');
});
test('earlier chapters, saved IDs and fixed feedback remain unchanged with no images or static checkpoints', () => {
  const before = buildLittleCloserChapter();
  buildDreamsInMotionChapter();
  expect(buildLittleCloserChapter()).toEqual(before);
  for (const l of lessons) {
    expect(l.backgroundImage).toBe('');
    expect(l.introductionData.introImage).toBe('');
    expect(l.applyData.situationImage).toBe('');
    expect(l.applyData.triviaImage).toBe('');
    expect(l.missionData.image).toBe('');
    expect(JSON.stringify(l)).not.toMatch(/https?:\/\/[^" ]+\.(?:png|webp|jpe?g)/i);
  }
  const previous = { id: 'keep-id', status: 'draft', feedbackData: { ...lessons[0].feedbackData, categories: [{ title: 'KEEP' }] } };
  const frozen = JSON.stringify(previous);
  const l = buildDreamsInMotionLesson(1, previous);
  expect(l.id).toBe('keep-id');
  expect(l.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(JSON.stringify(previous)).toBe(frozen);
  const checkpoints = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(checkpoints.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L4-C4-5-review', 'conversational-skills-L4-C4-10-review']);
});
