import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildWhereWeBelongChapter, buildWhereWeBelongLesson, whereWeBelongEpisodes, whereWeBelongId } from '../content/conversational-skills/ja/level-4-chapter-5/build';
import { buildDreamsInMotionChapter } from '../content/conversational-skills/ja/level-4-chapter-4/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildWhereWeBelongChapter();
test('the finale fills Level 4 Chapter 5 with the eight reference episodes and agreed skills', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.lessonName)).toEqual(['The Opportunity of a Lifetime', 'Trouble in Seoul', 'A Dream Comes True', 'A Trip to Fukuoka', 'The Bakery on the Corner', 'The Future of Kamo House', 'The Things We Leave Behind', 'Where We Belong']);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const l of lessons) {
    expect(l.id).toBe(whereWeBelongId(l.lessonNumber));
    expect([l.level, l.chapter, l.status, l.chapterName]).toEqual([4, 5, 'draft', 'Where We Belong']);
    expect(conversationalLessonErrors(l)).toEqual([]);
  }
});
test('five characters continue the existing story without unwanted role disclaimers or intimacy scenes', () => {
  expect(JSON.stringify(lessons)).not.toMatch(/\bkiss(?:ed|es|ing)?\b|キス|口づけ|invented adult character|You may play|No personal or romantic/i);
  expect(lessons[0].storyData.previousSummary).toContain('no award, brief or travel was confirmed yet');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(whereWeBelongEpisodes[storyLessonNumbers[i - 1]!].closing);
  for (const l of lessons) expect(l.storyData.characters.map((c: any) => c.name).sort()).toEqual(['Claire', 'Emma', 'Leo', 'Nao', 'Ren']);
  expect(lessons.map(l => l.missionData.situation.match(/^You are (\w+)/)?.[1])).toEqual(['Emma', 'Emma', 'Emma', 'Leo', 'Leo', 'Claire', 'Emma', 'Emma']);
});
test('Japanese support, vocabulary discussion and pronunciation, standard guides and fixed feedback remain complete', () => {
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
test('all speaking lessons are short alternating tutor-first dialogues with a supported roleplay', () => {
  for (const l of lessons.filter(l => l.skill === 'speaking')) {
    const lines = l.applyData.dialogueLines;
    expect(lines).toHaveLength(10);
    expect(lines.map((line: any) => line.text).join(' ').split(/\s+/).length).toBeLessThan(165);
    expect(lines[0].speaker).toBe(whereWeBelongEpisodes[l.lessonNumber as 1].apply.roles![0]);
    for (let i = 1; i < lines.length; i++) expect(lines[i].speaker).not.toBe(lines[i - 1].speaker);
    expect(l.missionData.tutorSteps[1].instruction).toContain('tutor speaks first');
    expect(l.missionData.tutorSteps[1].scripts[1].text).toStartWith('1.');
    expect(l.missionData.grammarTipItems.length).toBeGreaterThanOrEqual(5);
  }
});
test('two brief private listening scripts distinguish room arrangements from the adapter loan', () => {
  const l = lessons[1];
  expect(l.applyData.readingText).toBe('');
  expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.readingPassage).toBeUndefined();
  expect(l.missionData.listeningScript).toBeUndefined();
  const scripts = [l.applyData.tutorSteps[0].listeningScript, l.missionData.tutorSteps[1].listeningScript];
  for (const text of scripts) expect(text.replace(/<[^>]*>/g, '').trim().split(/\s+/).length).toBeLessThan(80);
  expect(scripts[0]).not.toBe(scripts[1]);
  expect(scripts[0]).toContain('partner hotel');
  expect(scripts[0]).toContain('cover the extra room cost');
  expect(scripts[1]).toContain('free of charge');
  expect(scripts[1]).toContain('test it with your laptop here before leaving');
  expect(scripts[1]).toContain('before six this evening');
  expect(scripts[1]).not.toContain('partner hotel');
});
test('each exercise has six Step A and four Step B items, complete keys and observed-error tracking', () => {
  for (const l of lessons) {
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.answers).toHaveLength(6);
    expect(l.exerciseData.tutorSteps[0].answerKey).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.stepBTutorSteps[1].answerKey).toHaveLength(4);
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
    for (const [sentence, answer] of whereWeBelongEpisodes[l.lessonNumber as 1].choose) expect(requireDefined(sentence.match(/\(([^)]+)\)/)?.[1], "sentence.match(/\\(([^)]+)\\)/)?.[1]").split(' / ')).toContain(answer);
    for (const item of whereWeBelongEpisodes[l.lessonNumber as 1].choices) expect(item[item[3] === 'A' ? 1 : 2]).not.toBe(item[item[3] === 'A' ? 2 : 1]);
  }
});
test('reading challenges provide fresh visible evidence rather than reusing the Apply text', () => {
  for (const l of [lessons[2], lessons[6]]) {
    expect(l.missionData.readingPassage.blocks[0].content).not.toBe(l.applyData.readingText);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
    expect(l.missionData.tutorSteps[2].tips[1].text).toContain('Fresh');
  }
});
test('Seoul progresses from shortlist to project award to a temporary accepted assignment with a return plan', () => {
  expect(lessons[0].missionData.situation).toContain('still shortlisted, not selected');
  const offer = lessons[2];
  expect(offer.applyData.readingText).toContain('Our agency has been selected');
  expect(offer.applyData.readingText).toContain('This is not a confirmed start date');
  const terms = offer.missionData.readingPassage.blocks[0].content;
  expect(terms).toContain('starting three weeks from today');
  expect(offer.missionData.situation).toContain('A week later');
  expect(terms).toContain('separate furnished apartments and return economy flights');
  expect(terms).toContain('Keep receipts for approved local work travel');
  expect(terms).toContain('return to their existing Japan-based roles');
  expect(terms).toContain('Acceptance is required before bookings');
  expect(offer.storyData.nextEpisodeHook).toContain('accept a temporary three-month');
});
test('the fictional bakery budget distinguishes setup, reserve, recurring costs and profit', () => {
  const l = lessons[4];
  expect(240000 + 350000 + 60000).toBe(650000);
  expect(1100000 - 650000 - 300000).toBe(150000);
  expect(l.missionData.situation).toContain('Monthly rent is ¥120,000');
  expect(l.missionData.situation).toContain('No lease is signed');
  expect(l.missionData.tutorSteps[1].tips[1].text).toContain('remainingcash notprofit');
  expect(l.storyData.nextEpisodeHook).toContain('It is not open yet');
  expect(lessons[6].missionData.readingPassage.blocks[0].content).toContain('still being fitted out');
  expect(lessons[7].storyData.currentEpisodeSummary).toContain('official opening');
});
test('Fukuoka and the cafe partnership develop Nao and Claire without inventing completed events', () => {
  expect(lessons[3].storyData.currentEpisodeSummary).toContain('finally take their previously discussed trip');
  expect(lessons[3].storyData.nextEpisodeHook).toContain('confirm exhibition details later');
  const partnership = lessons[5];
  expect(partnership.missionData.situation).toContain('twelve participants');
  expect(partnership.missionData.situation).toContain('date, costs and written responsibilities are not final');
  expect(partnership.storyData.nextEpisodeHook).toContain('before publicity');
  expect(partnership.storyData.nextEpisodeHook).toContain('not a permanent merger');
});
test('farewell arrangements are concrete and the finale completes the full-circle story without a new chapter', () => {
  const note = lessons[6].missionData.readingPassage.blocks[0].content;
  expect(note).toContain('first Sunday after arrival, at 8 p.m. in Kyoto');
  expect(note).toContain('Ren will send the invitation link');
  expect(note).toContain('later call dates will be agreed separately');
  const last = lessons[7];
  expect(last.missionData.situation).toContain('completed three-month Seoul assignment');
  expect(last.missionData.instruction).toContain('tutor will play the resident');
  expect(last.missionData.tutorSteps[1].scripts.map((s: any) => s.text).join(' ')).toContain('[As the new resident]');
  expect(last.storyData.nextEpisodeHook).toContain('The Kamo House story ends');
  expect(last.storyData.nextEpisodeHook).toContain('Lesson 10 is a personalised review');
});
test('earlier content, existing IDs and feedback are preserved and checkpoints stay dynamic without images', () => {
  const before = buildDreamsInMotionChapter();
  buildWhereWeBelongChapter();
  expect(buildDreamsInMotionChapter()).toEqual(before);
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
  const l = buildWhereWeBelongLesson(1, previous);
  expect(l.id).toBe('keep-id');
  expect(l.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(JSON.stringify(previous)).toBe(frozen);
  const checkpoints = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(checkpoints.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L4-C5-5-review', 'conversational-skills-L4-C5-10-review']);
});
