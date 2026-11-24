import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildNewPathsChapter, buildNewPathsLesson, newPathsEpisodes, newPathsId } from '../content/conversational-skills/ja/level-4-chapter-2/build';
import { buildAfterTruthChapter } from '../content/conversational-skills/ja/level-4-chapter-1/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildNewPathsChapter();
test('Level 4 Chapter 2 adapts all eight reference episodes in the established skill pattern', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.lessonName)).toEqual(['An Offer from Home', 'A Walk with Nao', "Emma's Fresh Start", "Claire's Brilliant Idea", 'The Great Pastry Disaster', 'Something More Than Friendship', 'A Decision About Bristol', 'A Brighter Tomorrow']);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const l of lessons) {
    expect(l.id).toBe(newPathsId(l.lessonNumber));
    expect(l.level).toBe(4);
    expect(l.chapter).toBe(2);
    expect(l.chapterName).toBe('New Paths, Unexpected Feelings');
    expect(l.status).toBe('draft');
    expect(conversationalLessonErrors(l)).toEqual([]);
  }
});
test('story continues the breakup and builds a warmer new arc without restoring the removed incident', () => {
  expect(JSON.stringify(lessons)).not.toMatch(/\bkiss(?:ed|es|ing)?\b|キス|口づけ|invented adult character|You may play|No personal or romantic/i);
  expect(lessons[0].storyData.previousSummary).toContain('Leo ended his relationship with Emma');
  expect(lessons[0].storyData.currentEpisodeSummary).toContain('A few weeks');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(newPathsEpisodes[requireDefined(storyLessonNumbers[i - 1], "storyLessonNumbers[i - 1]")].closing);
  expect(lessons[2].storyData.currentEpisodeSummary).toContain('professional');
  expect(lessons[3].missionData.situation).toContain('next Saturday');
  expect(lessons[4].storyData.currentEpisodeSummary).toContain('salt instead of sugar');
  expect(lessons[5].storyData.currentEpisodeSummary).toContain('still considering the Bristol offer');
  expect(lessons[6].storyData.currentEpisodeSummary).toContain('declines the Bristol role');
  expect(lessons[7].storyData.currentEpisodeSummary).toContain('congratulations from Osaka');
  expect(lessons[7].storyData.nextEpisodeHook).toContain('no second event is booked');
});
test('direct roles, bilingual support and fixed guides match the earlier chapters', () => {
  expect(lessons.map(l => l.missionData.situation.match(/^You are (\w+)/)?.[1])).toEqual(['Leo', 'Leo', 'Emma', 'Nao', 'Leo', 'Nao', 'Leo', 'Nao']);
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
test('speaking is concise tutor-first dialogue and the short listening scripts stay private', () => {
  for (const l of lessons.filter(l => l.skill === 'speaking')) {
    const lines = l.applyData.dialogueLines;
    expect(lines).toHaveLength(10);
    expect(lines.map((line: any) => line.text).join(' ').split(/\s+/).length).toBeLessThan(165);
    for (let i = 1; i < lines.length; i++) expect(lines[i].speaker).not.toBe(lines[i - 1].speaker);
    expect(lines[0].speaker).toBe(newPathsEpisodes[l.lessonNumber as 1].apply.roles![0]);
    expect(l.missionData.tutorSteps[1].instruction).toContain('tutor speaks first');
    expect(l.missionData.tutorSteps[1].scripts[1].text).toStartWith('1.');
  }
  const l = lessons[1];
  expect(l.applyData.readingText).toBe('');
  expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.missionData.readingPassage).toBeUndefined();
  expect(l.missionData.listeningScript).toBeUndefined();
  const scripts = [l.applyData.tutorSteps[0].listeningScript, l.missionData.tutorSteps[1].listeningScript];
  for (const text of scripts) expect(text.replace(/<[^>]*>/g, '').split(/\s+/).length).toBeLessThan(80);
  expect(scripts[0]).not.toBe(scripts[1]);
  expect(scripts[0]).toContain('at ten on Saturday');
  expect(scripts[1]).toContain('both hands');
});
test('six Step A and four Step B items have valid keys and preserve actual-mistake notes', () => {
  for (const l of lessons) {
    expect(l.exerciseData.stepAType).toBe('choose');
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.answers).toHaveLength(6);
    expect(l.exerciseData.tutorSteps[0].answerKey).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.stepBTutorSteps[1].answerKey).toHaveLength(4);
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
    for (const [sentence, answer] of newPathsEpisodes[l.lessonNumber as 1].choose) expect(requireDefined(sentence.match(/\(([^)]+)\)/)?.[1], "sentence.match(/\\(([^)]+)\\)/)?.[1]").split(' / ')).toContain(answer);
    for (const item of newPathsEpisodes[l.lessonNumber as 1].choices) expect(item[item[3] === 'A' ? 1 : 2]).not.toBe(item[item[3] === 'A' ? 2 : 1]);
  }
});
test('reading missions add fresh evidence and distinguish feedback, approval, deadlines and hopes', () => {
  for (const l of [lessons[2], lessons[6]]) {
    expect(l.missionData.readingPassage.blocks[0].content).not.toBe(l.applyData.readingText);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  const design = lessons[2].missionData.readingPassage.blocks[0].content;
  expect(design).toContain('address below the map');
  expect(design).toContain('Friday at 2 p.m.');
  expect(design).toContain('Do not send files to the printer until');
  const plans = lessons[6].missionData.readingPassage.blocks[0].content;
  expect(plans).toContain('Friday after 5 p.m.');
  expect(plans).toContain('Monday before noon');
  expect(plans).toContain('Wednesday at 3 p.m.');
  expect(plans).toContain('not rented a shop or set an opening date');
  expect(lessons[6].applyData.readingText).toContain('decline the role');
  expect(lessons[6].applyData.readingText).toContain('current bakery');
});
test('market preparation precedes success and invitations stay distinct from permanent commitments', () => {
  expect(lessons[3].missionData.tutorSteps[1].tips[1].text).toContain('Emma separate invitation');
  expect(lessons[4].missionData.tutorSteps[1].tips[1].text).toContain('Do not invent exact quantities');
  expect(lessons[4].missionData.situation).toContain('will not be sold');
  expect(lessons[5].missionData.situation).toContain('Bristol decision is still open');
  expect(lessons[6].storyData.nextEpisodeHook).toContain('market approaches');
  expect(lessons[7].applyData.dialogueLines.map((l: any) => l.text).join(' ')).toContain('A proper date?');
  expect(lessons[7].missionData.situation).toContain('free at 6 p.m.');
  expect(lessons[7].storyData.nextEpisodeHook).toContain('will confirm the restaurant');
  expect(lessons[7].storyData.nextEpisodeHook).not.toContain('reference');
});
test('earlier content, saved IDs, fixed feedback and checkpoints are preserved with no artwork', () => {
  const before = buildAfterTruthChapter();
  buildNewPathsChapter();
  expect(buildAfterTruthChapter()).toEqual(before);
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
  const l = buildNewPathsLesson(1, previous);
  expect(l.id).toBe('keep-id');
  expect(l.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(JSON.stringify(previous)).toBe(frozen);
  const checkpoints = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(checkpoints.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L4-C2-5-review', 'conversational-skills-L4-C2-10-review']);
});
