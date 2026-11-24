import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildLittleCloserChapter, buildLittleCloserLesson, littleCloserEpisodes, littleCloserId } from '../content/conversational-skills/ja/level-4-chapter-3/build';
import { buildNewPathsChapter } from '../content/conversational-skills/ja/level-4-chapter-2/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildLittleCloserChapter();
test('Level 4 Chapter 3 maps the eight reference scenes into the standard slots and skills', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.lessonName)).toEqual(['The First Real Date', 'A Second Chance in Osaka', 'A Familiar Face in Gion', 'The Most Awkward Coffee Ever', 'An Honest Conversation', 'A Surprise Invitation', 'Old Friends, New Beginnings', 'A Little Closer']);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const l of lessons) {
    expect(l.id).toBe(littleCloserId(l.lessonNumber));
    expect(l.level).toBe(4);
    expect(l.chapter).toBe(3);
    expect(l.chapterName).toBe('A Little Closer');
    expect(l.status).toBe('draft');
    expect(conversationalLessonErrors(l)).toEqual([]);
  }
});
test('continuity preserves the breakup while making Emma and Ren\'s new decision explicit', () => {
  expect(JSON.stringify(lessons)).not.toMatch(/\bkiss(?:ed|es|ing)?\b|キス|口づけ|invented adult character|You may play|No personal or romantic/i);
  expect(lessons[0].storyData.previousSummary).toContain('Emma and Leo remain separated');
  expect(lessons[0].missionData.situation).toContain('arrived at 5:45');
  expect(lessons[1].storyData.currentEpisodeSummary).toContain('mutually decide');
  expect(lessons[1].storyData.currentEpisodeSummary).toContain('kept their work contact professional');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(littleCloserEpisodes[requireDefined(storyLessonNumbers[i - 1], "storyLessonNumbers[i - 1]")].closing);
  expect(lessons[3].storyData.currentEpisodeSummary).toContain('salt');
  expect(lessons[4].storyData.currentEpisodeSummary).toContain('not use the relationship to forget Emma');
  expect(lessons[7].storyData.nextEpisodeHook).toContain('without reuniting');
});
test('direct roles, Japanese support, standard tutor guides and the fixed rubric are complete', () => {
  expect(lessons.map(l => l.missionData.situation.match(/^You are (\w+)/)?.[1])).toEqual(['Leo', 'Emma', 'Nao', 'Leo', 'Nao', 'Nao', 'Emma', 'Nao']);
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
test('speaking is short alternating dialogue and listening evidence is distinct, short and private', () => {
  for (const l of lessons.filter(l => l.skill === 'speaking')) {
    const lines = l.applyData.dialogueLines;
    expect(lines).toHaveLength(10);
    expect(lines.map((line: any) => line.text).join(' ').split(/\s+/).length).toBeLessThan(165);
    for (let i = 1; i < lines.length; i++) expect(lines[i].speaker).not.toBe(lines[i - 1].speaker);
    expect(lines[0].speaker).toBe(littleCloserEpisodes[l.lessonNumber as 1].apply.roles![0]);
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
  expect(scripts[0]).toContain('choose a meeting place tomorrow');
  expect(scripts[1]).toContain('Saturday at two is confirmed');
  expect(scripts[1]).toContain('Monday\'s team meeting');
});
test('six Step A and four Step B exercise items retain aligned keys and actual-mistake tracking', () => {
  for (const l of lessons) {
    expect(l.exerciseData.stepAType).toBe('choose');
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.answers).toHaveLength(6);
    expect(l.exerciseData.tutorSteps[0].answerKey).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.stepBTutorSteps[1].answerKey).toHaveLength(4);
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('actual incorrect responses');
    expect(l.exerciseData.stepBTutorSteps[0].tips[0].text).toContain('record actual mistakes');
    for (const [sentence, answer] of littleCloserEpisodes[l.lessonNumber as 1].choose) expect(requireDefined(sentence.match(/\(([^)]+)\)/)?.[1], "sentence.match(/\\(([^)]+)\\)/)?.[1]").split(' / ')).toContain(answer);
    for (const item of littleCloserEpisodes[l.lessonNumber as 1].choices) expect(item[item[3] === 'A' ? 1 : 2]).not.toBe(item[item[3] === 'A' ? 2 : 1]);
  }
});
test('reading missions supply new visible evidence and distinguish feelings from assumptions', () => {
  for (const l of [lessons[2], lessons[6]]) {
    expect(l.missionData.readingPassage.blocks[0].content).not.toBe(l.applyData.readingText);
    expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
  }
  const coffee = lessons[2].missionData.readingPassage.blocks[0].content;
  expect(coffee).toContain('All four have now agreed');
  expect(coffee).toContain('leave by 4:25');
  expect(coffee).toContain('has not been reserved');
  const friendship = lessons[6].missionData.readingPassage.blocks[0].content;
  expect(friendship).toContain('checking the photo order, not avoiding you');
  expect(friendship).toContain('I am sorry I guessed instead of asking');
  expect(friendship).toContain('says Bristol');
  expect(friendship).toContain('shows Kyoto');
  expect(friendship).toContain('11:30 a.m., by the front window');
});
test('the second market progresses from invitation to setup to success while travel stays unbooked', () => {
  expect(lessons[5].missionData.situation).toContain('Ren may help');
  expect(lessons[5].storyData.nextEpisodeHook).toContain('Ren later confirms');
  expect(lessons[6].storyData.currentEpisodeSummary).toContain('Ren carries frames');
  expect(lessons[6].storyData.nextEpisodeHook).toContain('11:30 photo talk');
  expect(lessons[7].storyData.currentEpisodeSummary).toContain('will become monthly');
  expect(lessons[7].storyData.nextEpisodeHook).toContain('next date to be confirmed');
  expect(lessons[7].missionData.situation).toContain('no travel dates or tickets are arranged');
  expect(lessons[7].applyData.dialogueLines.map((l: any) => l.text).join(' ')).toContain('We have not chosen any dates yet');
  expect(lessons[7].storyData.nextEpisodeHook).not.toContain('reference');
});
test('previous chapters, existing identity, fixed feedback and dynamic checkpoint slots remain untouched', () => {
  const before = buildNewPathsChapter();
  buildLittleCloserChapter();
  expect(buildNewPathsChapter()).toEqual(before);
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
  const l = buildLittleCloserLesson(1, previous);
  expect(l.id).toBe('keep-id');
  expect(l.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(JSON.stringify(previous)).toBe(frozen);
  const checkpoints = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' })));
  expect(checkpoints.filter(l => [5, 10].includes(l.lessonNumber)).map(l => l.id)).toEqual(['conversational-skills-L4-C3-5-review', 'conversational-skills-L4-C3-10-review']);
});
