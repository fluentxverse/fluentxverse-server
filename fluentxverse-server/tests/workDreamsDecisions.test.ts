import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildCareerChapter, buildCareerLesson, chapter4Episodes, chapter4Id } from '../content/conversational-skills/ja/level-3-chapter-4/build';
import { buildEverydayChapter } from '../content/conversational-skills/ja/level-3-chapter-3/build';
import { storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';
import { addAvailableCheckpoints } from '../src/services/checkpointLesson.service';

const lessons: any[] = buildCareerChapter();
test('Chapter 4 fills the missing openings and maps the supplied six episodes to the right slots', () => {
  expect(lessons.map(l => l.lessonNumber)).toEqual([1, 2, 3, 4, 6, 7, 8, 9]);
  expect(lessons.map(l => l.lessonName)).toEqual(['A Message from Osaka', 'Leo\'s New Challenge', 'A New Idea for the Cafe', 'The First Customer', 'The Interview', 'A Recipe for Success', 'A Choice to Make', 'The Decision']);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  for (const l of lessons) {
    expect(l.id).toBe(chapter4Id(l.lessonNumber));
    expect(l.level).toBe(3);
    expect(l.chapter).toBe(4);
    expect(l.chapterName).toBe('Work, Dreams & Decisions');
    expect(l.status).toBe('draft');
    expect(conversationalLessonErrors(l)).toEqual([]);
    expect(l.backgroundImage).toBe('');
    expect(l.introductionData.introImage).toBe('');
    expect(l.applyData.situationImage).toBe('');
    expect(l.missionData.image).toBe('');
    expect(JSON.stringify(l)).not.toMatch(/https?:|Gojo Art Room|old poster|missing cups|Yuki|[\uac00-\ud7af]/u);
  }
});
test('direct roles, Japanese support and the established guide structure appear throughout', () => {
  for (const l of lessons) {
    const learn = l.learnData.steps[0];
    expect(l.missionData.situation).toMatch(/^You are (Emma|Nao)/);
    expect(JSON.stringify(l)).not.toMatch(/You may play|invented adult character|No personal or romantic|personal romantic disclosures|Please be Emma or/);
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
    for (const text of [l.goalTextJp, l.introductionData.introTexts[1].text, l.applyData.situationTranslation, l.missionData.situationTranslation, l.missionData.instructionTranslation, ...learn.vocabularyItems.map((v: any) => v.translation)]) expect(text).toMatch(/[ぁ-んァ-ン]/u);
  }
});
test('exercise choices and keys are complete and assessment-ready', () => {
  for (const l of lessons) {
    expect(l.exerciseData.stepAType).toBe('choose');
    expect(l.exerciseData.chooseItems).toHaveLength(6);
    expect(l.exerciseData.answers).toHaveLength(6);
    expect(l.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(l.exerciseData.stepBTutorSteps[1].answerKey).toHaveLength(4);
    expect(l.exerciseData.tutorSteps[0].tips[0].text).toContain('incorrect');
    for (const [sentence, answer] of chapter4Episodes[l.lessonNumber as 1].choose) expect(requireDefined(sentence.match(/\(([^)]+)\)/)?.[1], "sentence.match(/\\(([^)]+)\\)/)?.[1]").split(' / ')).toContain(answer);
    for (const c of chapter4Episodes[l.lessonNumber as 1].choices) expect(c[c[3] === 'A' ? 1 : 2]).not.toBe(c[c[3] === 'A' ? 2 : 1]);
  }
});
test('speaking is concise dialogue and listening evidence stays in the tutor guide', () => {
  for (const l of lessons.filter(l => l.skill === 'speaking')) {
    const lines = l.applyData.dialogueLines;
    expect(lines).toHaveLength(10);
    expect(lines.map((line: any) => line.text).join(' ').split(/\s+/).length).toBeLessThan(165);
    for (let i = 1; i < lines.length; i++) expect(lines[i].speaker).not.toBe(lines[i - 1].speaker);
    expect(l.missionData.tutorSteps[1].instruction).toContain('tutor speaks first');
    expect(l.missionData.tutorSteps[1].scripts[1].text).toStartWith('1.');
    expect(l.missionData.instruction).not.toMatch(/monologue|90.second|uninterrupted/);
  }
  const l = lessons[1];
  expect(l.applyData.dialogueLines).toEqual([]);
  expect(l.applyData.readingText).toBe('');
  expect(l.missionData.readingPassage).toBeUndefined();
  expect(l.missionData.listeningScript).toBeUndefined();
  for (const text of [l.applyData.tutorSteps[0].listeningScript, l.missionData.tutorSteps[1].listeningScript]) expect(text.replace(/<[^>]*>/g, '').split(/\s+/).length).toBeLessThan(80);
});
test('workshop math and the new reading task distinguish budget from all the other conditions', () => {
  const l = lessons[2];
  expect(l.applyData.readingText).toContain('4,500');
  expect(l.applyData.tutorSteps[1].questions[1].answer).toContain('6,500');
  const mission = l.missionData.readingPassage.blocks[0].content;
  expect(mission).toContain('3,200');
  expect(mission).toContain('5,800');
  expect(mission).toContain('Two hours. Six people.');
  expect(l.missionData.tutorSteps[2].tips[1].text).toContain('leaves2800');
  expect(mission).not.toBe(l.applyData.readingText);
  expect(l.missionData.tutorSteps[1].tips[0].text).toContain('visible');
});
test('Nao confirms a custom order without promising an impossible delivery date', () => {
  const l = lessons[3];
  expect(l.missionData.situation).toContain('You are Nao.');
  expect(l.missionData.situation).toContain('three weeks');
  expect(l.missionData.tutorSteps[1].tips[1].text).toContain('cup total7200/box500/final7700');
  expect(l.missionData.tutorSteps[1].tips[1].text).toContain('cannot promise1week');
  expect(l.applyData.dialogueLines.map((line: any) => line.text).join(' ')).toContain('10,100 yen altogether');
});
test('all four characters retain their career goals and the sequence connects interview to offer', () => {
  expect(lessons[0].goalTextEn).toContain('work opportunity');
  expect(lessons[1].storyData.currentEpisodeSummary).toContain('manager');
  expect(lessons[2].storyData.currentEpisodeSummary).toContain('Claire wants weekly workshops');
  expect(lessons[3].storyData.currentEpisodeSummary).toContain('first direct order');
  expect(lessons[4].storyData.currentEpisodeSummary).toContain('interview');
  expect(lessons[5].storyData.currentEpisodeSummary).toContain('regular menu');
  expect(lessons[6].storyData.currentEpisodeSummary).toContain('higher, fixed salary');
  expect(lessons[0].storyData.nextEpisodeHook).not.toContain('accepted');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(chapter4Episodes[requireDefined(storyLessonNumbers[i - 1], "storyLessonNumbers[i - 1]")].closing);
});
test('the final roleplay has a tutor-first character switch and deliberately ends before approval', () => {
  const l = lessons[7];
  const scripts = l.missionData.tutorSteps[1].scripts.map((s: any) => s.text).join('\n');
  expect(scripts).toContain('Now I will be the agency recruiter. Please stay as Emma. I will start the phone call.');
  expect(scripts).toContain('4. Hello Emma.');
  expect(scripts).toContain('not confirmed');
  expect(scripts).toContain('Monday morning');
  expect(l.missionData.situation).toContain('offer still requires five office days');
  expect(l.missionData.instruction).toContain('still being considered');
  expect(l.storyData.nextEpisodeHook).toContain('final answer has not arrived');
  expect(l.storyData.nextEpisodeHook).toContain('has not accepted or declined');
  expect(l.storyData.nextEpisodeHook).toContain('Chapter 5');
  const reading = lessons[6].missionData.readingPassage.blocks[0].content;
  expect(reading).toContain('suggestion, not part of the offer');
  expect(reading).toContain('reply by Monday at 5 p.m.');
});
test('new content leaves previous chapters intact and checkpoints dynamic', () => {
  const prior = buildEverydayChapter();
  buildCareerChapter();
  expect(buildEverydayChapter()).toEqual(prior);
  const checkpoints = addAvailableCheckpoints(lessons.map(l => ({ ...l, status: 'published' }))).filter(l => [5, 10].includes(l.lessonNumber));
  expect(checkpoints.map(l => l.id)).toEqual(['conversational-skills-L3-C4-5-review', 'conversational-skills-L3-C4-10-review']);
  const previous = { id: 'existing-id', status: 'draft', feedbackData: { ...lessons[0].feedbackData, categories: [{ title: 'unchanged' }] } };
  const frozen = JSON.stringify(previous);
  const l = buildCareerLesson(1, previous);
  expect(l.id).toBe('existing-id');
  expect(l.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(JSON.stringify(previous)).toBe(frozen);
});
