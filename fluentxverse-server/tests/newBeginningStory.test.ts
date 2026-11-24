import { requireDefined } from '../../shared/requireDefined';
import { expect, test } from 'bun:test';
import { buildChapter } from '../content/conversational-skills/ja/level-3-chapter-1/build';
import { buildNewBeginningLesson, newBeginningEpisodes, newBeginningIds, newBeginningWatercolor, storyLessonNumbers } from '../content/conversational-skills/ja/level-3-chapter-1/new-beginning';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';

const chapter = buildChapter('https://api.fluentxverse.com');
const lessons = storyLessonNumbers.map(number => chapter[number - 1] as any);
test('new chapter generation uses twenty-four watercolor scenes for all eight story lessons', () => {
  const urls = new Set<string>();
  for (const number of storyLessonNumbers) {
    const art = newBeginningWatercolor(number, 'https://api.fluentxverse.com/');
    const lesson: any = chapter[number - 1];
    expect(lesson.backgroundImage).toBe(art.introduce);
    expect(lesson.introductionData.introImage).toBe(art.introduce);
    expect(lesson.applyData.situationImage).toBe(art.apply);
    expect(lesson.missionData.image).toBe(art.challenge1);
    for (const url of Object.values(art)) {
      expect(url).toEndWith('.webp');
      expect(url).toContain('/new-beginning-watercolor-v1/');
      urls.add(url);
    }
  }
  expect(urls.size).toBe(24);
  expect(newBeginningWatercolor(4, 'https://api.fluentxverse.com').apply).toEndWith('lesson4-apply-new-beginning-watercolor-v2.webp');
  expect(newBeginningWatercolor(6, 'https://api.fluentxverse.com').challenge1).toEndWith('lesson6-challenge1-new-beginning-watercolor-v3.webp');
  for (const url of Object.values(newBeginningWatercolor(8, 'https://api.fluentxverse.com'))) expect(url).toEndWith('-watercolor-v2.webp');
});
test('the eight user story episodes map to Lessons 1-4 and 6-9 with stable IDs and agreed skills', () => {
  expect(lessons.map(l => l.lessonName)).toEqual(['A New Beginning', 'The Sunday Cafe', 'A Shared Hobby', 'A Walk Through Kyoto', 'An Interesting Idea', 'An Unexpected Problem', 'The Exhibition', 'A Place to Call Home']);
  expect(lessons.map(l => l.skill)).toEqual(['speaking', 'listening', 'reading', 'speaking', 'speaking', 'speaking', 'reading', 'speaking']);
  expect(lessons.map(l => l.id)).toEqual(storyLessonNumbers.map(n => newBeginningIds[n]));
  expect(chapter[4].lessonNumber).toBe(5);
  expect(chapter[9].lessonNumber).toBe(10);
  for (const lesson of lessons) {
    expect(conversationalLessonErrors(lesson)).toEqual([]);
    expect(lesson.chapterName).toBe('A New Beginning');
    expect(lesson.storyData.characters.map((c: any) => c.name)).toEqual(['Emma', 'Claire', 'Leo', 'Nao']);
    expect(JSON.stringify(lesson)).not.toMatch(/Gojo Art Room|old poster|missing cups|pipe broke|pipe bursts|former.*teacher|bike.rental|Maple House|Yuki|Sara|Aisha/iu);
  }
});
test('new story events and chronological transitions follow the user narrative', () => {
  expect(newBeginningEpisodes[1].intro[0]).toContain('first day');
  expect(newBeginningEpisodes[2].intro[0]).toContain('Sunday morning');
  expect(newBeginningEpisodes[3].intro[0]).toContain('camera');
  expect(newBeginningEpisodes[4].intro[0]).toContain('Saturday');
  expect(newBeginningEpisodes[6].intro[0]).toContain('small art exhibition');
  expect(newBeginningEpisodes[7].intro[0]).toContain('Two days before');
  expect(newBeginningEpisodes[7].intro[0]).toContain('oven breaks');
  expect(newBeginningEpisodes[8].closing).toContain('proud');
  expect(newBeginningEpisodes[9].intro[0]).toContain('Kamo River');
  for (let i = 1; i < lessons.length; i++) expect(lessons[i].storyData.previousSummary).toBe(newBeginningEpisodes[requireDefined(storyLessonNumbers[i - 1], "storyLessonNumbers[i - 1]")].closing);
});
test('all eight retain standardized guides, Japanese support, fixed feedback and exercise markings', () => {
  for (const lesson of lessons) {
    const learn = lesson.learnData.steps[0];
    expect(lesson.introductionData.lessonGoalSteps).toHaveLength(4);
    expect(learn.vocabularyItems).toHaveLength(6);
    expect(learn.tutorSteps).toHaveLength(5);
    expect(learn.discussionPart.tutorSteps).toHaveLength(5);
    expect(learn.pronunciationPart.tutorSteps).toHaveLength(5);
    expect(lesson.stepBData.grammarTip.tutorSteps).toHaveLength(2);
    expect(lesson.applyData.tutorSteps).toHaveLength(2);
    expect(lesson.applyData.triviaTutorSteps).toHaveLength(4);
    expect(lesson.missionData.tutorSteps).toHaveLength(lesson.skill === 'speaking' ? 3 : 4);
    expect(lesson.feedbackData.tutorSteps).toHaveLength(6);
    expect(lesson.feedbackData.categories.map((c: any) => c.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    expect(lesson.feedbackData.rubricLevels.map((r: any) => r.score)).toEqual([4, 3, 2, 1]);
    expect(lesson.exerciseData.chooseItems).toHaveLength(6);
    expect(lesson.exerciseData.answers).toHaveLength(6);
    expect(lesson.exerciseData.multipleChoiceItems).toHaveLength(4);
    expect(lesson.missionData2.topics).toHaveLength(3);
    expect(lesson.missionData.grammarTipItems.length).toBeGreaterThanOrEqual(4);
    for (const text of [lesson.goalTextJp, lesson.applyData.situationTranslation, lesson.missionData.situationTranslation, lesson.missionData.instructionTranslation, ...learn.vocabularyItems.map((item: any) => item.translation)]) expect(text).toMatch(/[ぁ-んァ-ン]/u);
    expect(lesson.exerciseData.tutorSteps[0].tips[0].text).toContain('incorrect');
  }
});
test('speaking remains a short dialogue; listening scripts remain private and brief', () => {
  for (const lesson of lessons.filter(l => l.skill === 'speaking')) {
    const lines = lesson.applyData.dialogueLines;
    expect(lines).toHaveLength(10);
    expect(new Set(lines.map((l: any) => l.speaker)).size).toBe(2);
    expect(lines.map((l: any) => l.text).join(' ').split(/\s+/).length).toBeLessThan(150);
    for (let i = 1; i < lines.length; i++) expect(lines[i].speaker).not.toBe(lines[i - 1].speaker);
    expect(lesson.missionData.tutorSteps[1].instruction).toContain('tutor speaks first');
    expect(lesson.missionData.tutorSteps[1].scripts[0].text).toContain("I'll start.");
    expect(lesson.missionData.readingPassage).toBeUndefined();
    expect(lesson.missionData.tutorSteps.some((s: any) => s.listeningScript)).toBe(false);
  }
  const listening = lessons[1];
  expect(listening.applyData.dialogueLines).toEqual([]);
  expect(listening.applyData.readingText).toBe('');
  expect(listening.missionData.readingPassage).toBeUndefined();
  for (const script of [listening.applyData.tutorSteps[0].listeningScript, listening.missionData.tutorSteps[1].listeningScript]) {
    expect(script.replace(/<[^>]*>/g, '').split(/\s+/).length).toBeLessThan(80);
    expect(script).toContain('I ');
  }
});
test('reading lessons have distinct Apply and Mission evidence without old notices', () => {
  for (const lesson of lessons.filter(l => l.skill === 'reading')) {
    const apply = lesson.applyData.readingText;
    const mission = lesson.missionData.readingPassage.blocks[0].content;
    expect(apply).not.toBe(mission);
    expect(mission).toMatch(/Saturday|Sunday/);
    expect(lesson.missionData.tutorSteps[1].tips[0].text).toContain('visible');
    expect(lesson.missionData.tutorSteps[2].instruction).toContain('tutor speaks first');
  }
  expect(lessons[2].missionData.readingPassage.blocks[0].content).toContain('10 a.m.');
  expect(lessons[2].missionData.readingPassage.blocks[1]).toEqual({ type: 'images', images: [lessons[2].missionData.image] });
  expect(lessons[6].missionData.readingPassage.blocks[0].content).toContain('3:30 p.m.');
  expect(lessons[6].missionData.readingPassage.blocks[1]).toEqual({ type: 'images', images: [lessons[6].missionData.image] });
});
test('migration builder preserves identities, fixed rubric, publication status, and compatible artwork', () => {
  const previous = { ...lessons[0], status: 'published', updatedAt: 'revision', backgroundImage: 'existing-cover.webp', introductionData: { ...lessons[0].introductionData, introImage: 'existing-intro.webp' }, feedbackData: { ...lessons[0].feedbackData, categories: [{ title: 'unchanged' }] } };
  const result = { ...previous, ...buildNewBeginningLesson(1, previous, 'https://api.fluentxverse.com', lessons[3]) };
  expect(result.id).toBe(previous.id);
  expect(result.status).toBe('published');
  expect(result.updatedAt).toBe('revision');
  expect(result.feedbackData.categories).toEqual(previous.feedbackData.categories);
  expect(result.backgroundImage).toBe(previous.backgroundImage);
  expect(result.introductionData.introImage).toBe('existing-intro.webp');
  const third = lessons[2];
  const preservedThird = buildNewBeginningLesson(3, third, 'https://api.fluentxverse.com', lessons[3]);
  expect(preservedThird.introductionData.introImage).toBe(third.introductionData.introImage);
  expect(preservedThird.applyData.situationImage).toBe(third.applyData.situationImage);
  expect(preservedThird.missionData.image).toBe(third.missionData.image);
  const fourth = lessons[3];
  const preservedFourth = buildNewBeginningLesson(4, fourth, 'https://api.fluentxverse.com', third);
  expect(preservedFourth.introductionData.introImage).toBe(fourth.introductionData.introImage);
  expect(preservedFourth.applyData.situationImage).toBe(fourth.applyData.situationImage);
  expect(preservedFourth.missionData.image).toBe(fourth.missionData.image);
  const sixth = lessons[4];
  const preservedSixth = buildNewBeginningLesson(6, sixth, 'https://api.fluentxverse.com', fourth);
  expect(preservedSixth.introductionData.introImage).toBe(sixth.introductionData.introImage);
  expect(preservedSixth.applyData.situationImage).toBe(sixth.applyData.situationImage);
  expect(preservedSixth.missionData.image).toBe(sixth.missionData.image);
  const seventh = lessons[5];
  const preservedSeventh = buildNewBeginningLesson(7, seventh, 'https://api.fluentxverse.com', sixth);
  expect(preservedSeventh.introductionData.introImage).toBe(seventh.introductionData.introImage);
  expect(preservedSeventh.applyData.situationImage).toBe(seventh.applyData.situationImage);
  expect(preservedSeventh.missionData.image).toBe(seventh.missionData.image);
  const eighth = lessons[6];
  const preservedEighth = buildNewBeginningLesson(8, eighth, 'https://api.fluentxverse.com', seventh);
  expect(preservedEighth.introductionData.introImage).toBe(eighth.introductionData.introImage);
  expect(preservedEighth.applyData.situationImage).toBe(eighth.applyData.situationImage);
  expect(preservedEighth.missionData.image).toBe(eighth.missionData.image);
  expect(preservedEighth.missionData.readingPassage.blocks[1]).toEqual(eighth.missionData.readingPassage.blocks[1]);
  const ninth = lessons[7];
  const preservedNinth = buildNewBeginningLesson(9, ninth, 'https://api.fluentxverse.com', eighth);
  expect(preservedNinth.backgroundImage).toBe(ninth.backgroundImage);
  expect(preservedNinth.introductionData.introImage).toBe(ninth.introductionData.introImage);
  expect(preservedNinth.applyData.situationImage).toBe(ninth.applyData.situationImage);
  expect(preservedNinth.missionData.image).toBe(ninth.missionData.image);
  expect(preservedNinth.learnData.steps[0].vocabularyItems.map((v: any) => v.image)).toEqual(ninth.learnData.steps[0].vocabularyItems.map((v: any) => v.image));
});
