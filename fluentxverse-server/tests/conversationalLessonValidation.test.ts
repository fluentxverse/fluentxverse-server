import { describe, expect, test } from 'bun:test';
import { buildChapter } from '../content/conversational-skills/ja/level-3-chapter-1/build';
import { buildLesson2 } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-2-listening';
import { buildLesson3 } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-3-reading';
import { buildLesson4 } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-4-speaking';
import { conversationalLessonErrors } from '../src/utils/conversationalLessonValidation';

const chapter = buildChapter('http://localhost:8765');
describe('Japanese Level 3 Chapter 1', () => {
  test('all ten lessons have complete active sections with aligned skills', () => {
    expect(chapter).toHaveLength(10);
    for (const lesson of chapter) {
      expect(conversationalLessonErrors(lesson)).toEqual([]);
      expect(lesson.applyData.activityType).toBe(lesson.skill);
      expect(lesson.missionData.missionType).toBe(lesson.skill);
      expect(lesson.introductionData.introTexts.find(t => t.language === 'ja')?.text).toMatch(/[ぁ-んァ-ン]/u);
      expect(JSON.stringify(lesson)).not.toMatch(/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u);
    }
    expect(new Set(chapter.map(l => l.skill)).size).toBe(3);
    expect(new Set(chapter.map(l => l.exerciseData.stepAType)).size).toBe(3);
    expect(new Set(chapter.map(l => l.stepBData.stepType)).size).toBe(3);
  });
  test('authoring corrections keep openings and roleplays natural', () => {
    for (const lesson of chapter) {
      const [goalStep, situationStep] = lesson.introductionData.lessonGoalSteps;
      expect(goalStep).toBeDefined();
      expect(situationStep).toBeDefined();
      if (!goalStep || !situationStep) throw new Error('Introduction requires goal and situation steps.');
      expect(goalStep.script).toStartWith(lesson.lessonNumber >= 6 && lesson.lessonNumber <= 9
        ? 'Our objective for today is:' : 'Our goal for today is:');
      expect(goalStep.script).toEndWith('Is it clear?');
      expect(situationStep.script).toStartWith(lesson.lessonNumber >= 6 && lesson.lessonNumber <= 9
        ? 'Here is our situation.' : "Here's our situation.");
      expect(lesson.applyData.situationText).not.toMatch(/<[^>]+>/);
      expect(lesson.applyData.situationTranslation).toMatch(/[ぁ-んァ-ン]/u);
    }
    for (const lesson of chapter.filter(lesson => lesson.skill === 'speaking' && (lesson.lessonNumber <= 5 || lesson.lessonNumber === 10))) {
      const roleplayStep = lesson.missionData.tutorSteps.find(step => step.instruction.includes('roleplay'));
      expect(roleplayStep?.instruction).toContain('tutor always speaks first');
      expect(roleplayStep?.scripts?.[0]?.text).toMatch(/^1\.\s*(Hi|Hello|Where|What|Who|Do|Are|Is|Can)/);
    }
    const firstLesson = chapter[0];
    expect(firstLesson).toBeDefined();
    if (!firstLesson) throw new Error('Chapter requires Lesson 1.');
    expect(JSON.stringify(firstLesson.missionData)).not.toContain('Tell me one thing about yourself.');
    expect(JSON.stringify(firstLesson.missionData)).not.toContain('What can you ask me?');
  });
  test('inactive exercise content cannot satisfy an empty selected branch', () => {
    const lesson: any = structuredClone(chapter[0]);
    lesson.exerciseData.stepAType = 'rephrase';
    expect(lesson.exerciseData.chooseItems.length).toBeGreaterThan(0);
    expect(conversationalLessonErrors(lesson)).toContain('Exercise Step A must contain complete items.');
    lesson.exerciseData.stepBType = 'compare';
    expect(conversationalLessonErrors(lesson)).toContain('Exercise Step B must contain complete items.');
  });
  test('a listening label requires a usable tutor script in each activity', () => {
    const lesson: any = structuredClone(chapter[1]);
    lesson.applyData.tutorSteps = [];
    lesson.missionData.tutorSteps = [{ instruction: 'Listen.' }];
    expect(conversationalLessonErrors(lesson)).toContain('Apply listening needs a tutor listening script.');
    expect(conversationalLessonErrors(lesson)).toContain('Listening Mission needs a script in the tutor guide.');
  });
  test('reading requires a passage and enabled trivia requires content', () => {
    const lesson: any = structuredClone(chapter[3]);
    lesson.applyData.readingText = '<p> </p>';
    lesson.applyData.triviaEnabled = true;
    lesson.missionData.readingPassage.blocks = [{ type: 'images', images: ['image.webp'] }];
    expect(conversationalLessonErrors(lesson)).toContain('Apply reading passage is required.');
    expect(conversationalLessonErrors(lesson)).toContain('Reading Mission needs a passage.');
    expect(conversationalLessonErrors(lesson)).toContain('Enabled trivia is required.');
  });
  test('mismatched lesson and activity skills are rejected', () => {
    const lesson: any = structuredClone(chapter[0]);
    lesson.skill = 'listening';
    expect(conversationalLessonErrors(lesson)).toContain('Apply activity must match the lesson skill.');
    expect(conversationalLessonErrors(lesson)).toContain('Mission activity must match the lesson skill.');
  });
  test('optional receptive challenges may use a complete discussion or a skill-aligned activity', () => {
    const lesson: any = structuredClone(chapter[1]);
    Object.assign(lesson, buildLesson2(lesson, 'http://localhost:8765'));
    expect(lesson.missionData2.missionType).toBe('discussion');
    expect(conversationalLessonErrors(lesson)).toEqual([]);
    lesson.missionData2.topics[0].questions = [];
    expect(conversationalLessonErrors(lesson)).toContain('Discussion Challenge 2 needs categories with questions.');
    lesson.missionData2.missionType = 'listening';
    lesson.missionData2.tutorSteps = [];
    expect(conversationalLessonErrors(lesson)).toContain('Listening Challenge 2 needs a script in the tutor guide.');
  });
  test('Lesson 2 uses objective wording and the standard feedback guide', () => {
    const lesson: any = structuredClone(chapter[1]);
    Object.assign(lesson, buildLesson2(lesson, 'http://localhost:8765'));
    expect(lesson.introductionData.lessonGoalSteps[0].script).toStartWith('Our objective for today is:');
    expect(lesson.feedbackData.rubricTitle).toBe('LESSON OBJECTIVE ACHIEVEMENT');
    expect(lesson.feedbackData.rubricLevels.map((level: any) => level.score)).toEqual([4, 3, 2, 1]);
    expect(lesson.feedbackData.personalizedFeedbackTitle).toBe('PERSONALIZED FEEDBACK');
    expect(lesson.feedbackData.categories.map((category: any) => category.title)).toEqual(['RANGE', 'ACCURACY', 'FLUENCY']);
    expect(lesson.feedbackData.tutorSteps).toHaveLength(6);
    expect(lesson.feedbackData.tutorSteps[1].instruction).toContain('lesson objective');
    expect(lesson.feedbackData.tutorSteps[3].tips[0].text).toContain('Challenge 1');
    expect(lesson.feedbackData.tutorSteps[5].instruction).toBe('Wrap up the lesson.');
  });
  test('Lesson 3 is a complete Kyoto reading lesson with usable service lists', () => {
    const lesson: any = { ...chapter[2], ...buildLesson3(chapter[2], 'https://api.fluentxverse.xyz') };
    expect(conversationalLessonErrors(lesson)).toEqual([]);
    expect(lesson.id).toBe('conversational-skills-L3-C1-3-reading-ja-v1');
    expect(lesson.skill).toBe('reading');
    expect(lesson.applyData.activityType).toBe('reading');
    expect(lesson.missionData.missionType).toBe('reading');
    expect(lesson.applyData.readingText).toContain('¥2,900');
    expect(lesson.applyData.tutorSteps[1].questions[1].answer).toContain('¥3,100');
    expect(lesson.missionData.readingPassage.blocks).toHaveLength(3);
    expect(lesson.missionData.tutorSteps[1].scripts[0].text).toStartWith('Hi!');
    expect(lesson.missionData2.topics).toHaveLength(3);
    expect(lesson.feedbackData.tutorSteps).toHaveLength(6);
    expect(lesson.feedbackData.rubricTitle).toBe('LESSON OBJECTIVE ACHIEVEMENT');
    expect(lesson.applyData.triviaTutorSteps[1].instruction).toContain('student to read');
    expect(lesson.learnData.steps[0].vocabularyItems).toHaveLength(6);
    expect(lesson.learnData.steps[0].vocabularyItems.every((item: any) => item.image.startsWith('https://'))).toBe(true);
    expect(lesson.applyData.situationText).not.toMatch(/<[^>]+>/);
    expect(JSON.stringify(lesson)).not.toMatch(/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u);
  });
  test('Lesson 4 is a sustained speaking lesson without images', () => {
    const lesson: any = { ...chapter[3], ...buildLesson4(chapter[3], 'https://api.fluentxverse.xyz') };
    expect(conversationalLessonErrors(lesson)).toEqual([]);
    expect(lesson.id).toBe('conversational-skills-L3-C1-4-speaking-ja-v1');
    expect(lesson.skill).toBe('speaking');
    expect(lesson.applyData.activityType).toBe('speaking');
    expect(lesson.applyData.dialogueLines).toHaveLength(1);
    expect(lesson.missionData.missionType).toBe('speaking');
    expect(lesson.missionData.instruction).toContain('90-second talk without tutor interruptions');
    expect(lesson.missionData.grammarTipItems).toHaveLength(3);
    expect(lesson.missionData.tutorSteps[1].scripts[0].text).toContain("I'm ready to listen");
    expect(lesson.missionData.tutorSteps[2].instruction).toContain('After the learner finishes');
    expect(lesson.missionData2.topics).toHaveLength(3);
    expect(lesson.feedbackData.tutorSteps).toHaveLength(6);
    expect(lesson.introductionData.lessonGoalSteps[0].script).toStartWith('Our objective for today is:');
    expect(lesson.backgroundImage).toBe('');
    expect(lesson.introductionData.introImage).toBe('');
    expect(lesson.learnData.steps[0].vocabularyItems.every((item: any) => item.image === '')).toBe(true);
    expect(lesson.applyData.situationImage).toBe('');
    expect(lesson.applyData.triviaImage).toBe('');
    expect(lesson.missionData.image).toBe('');
    expect(JSON.stringify(lesson)).not.toMatch(/https?:\/\/[^" ]+\.(?:webp|png|jpe?g)/i);
  });
  test('listening sources stay out of the student content fields', () => {
    for (const lesson of chapter.filter(l => l.skill === 'listening')) {
      expect(lesson.applyData.dialogueLines).toEqual([]);
      expect(lesson.applyData.readingText).toBeUndefined();
      expect(lesson.missionData.readingPassage).toBeUndefined();
      expect(lesson.missionData2.missionType).toBe(lesson.lessonNumber >= 6 ? 'discussion' : 'listening');
    }
  });
  test('Lessons 6-9 continue the Kyoto story with the listening, reading, speaking, listening sequence', () => {
    const arc: any[] = chapter.slice(5, 9);
    expect(arc.map(lesson => lesson.skill)).toEqual(['listening', 'reading', 'speaking', 'listening']);
    expect(arc.map(lesson => lesson.id)).toEqual([
      'conversational-skills-L3-C1-6-listening-ja-v1',
      'conversational-skills-L3-C1-7-reading-ja-v1',
      'conversational-skills-L3-C1-8-speaking-ja-v1',
      'conversational-skills-L3-C1-9-listening-ja-v1',
    ]);
    for (const lesson of arc) {
      expect(conversationalLessonErrors(lesson)).toEqual([]);
      expect(lesson.introductionData.lessonGoalSteps[0].script).toContain(lesson.goalTextEn);
      expect(lesson.learnData.steps[0].vocabularyItems).toHaveLength(6);
      expect(lesson.learnData.steps[0].vocabularyItems.every((item: any) => item.image === '')).toBe(true);
      expect(lesson.stepBData.grammarTip.explanations).toHaveLength(2);
      expect(lesson.exerciseData.chooseItems).toHaveLength(4);
      expect(lesson.exerciseData.answers).toHaveLength(4);
      expect(lesson.exerciseData.multipleChoiceItems).toHaveLength(4);
      expect(lesson.missionData2.topics).toHaveLength(3);
      expect(lesson.feedbackData.tutorSteps).toHaveLength(6);
      expect(lesson.feedbackData.rubricTitle).toBe('LESSON OBJECTIVE ACHIEVEMENT');
      expect(lesson.applyData.triviaTutorSteps[1].instruction).toContain('student to read');
      expect(lesson.storyData.setting).toContain('Kyoto');
      expect(lesson.backgroundImage).toBe('');
      expect(lesson.introductionData.introImage).toBe('');
      expect(lesson.applyData.situationImage).toBe('');
      expect(lesson.applyData.triviaImage).toBe('');
      expect(lesson.missionData.image).toBe('');
      expect(JSON.stringify(lesson)).not.toMatch(/https?:\/\/[^" ]+\.(?:webp|png|jpe?g)/i);
      expect(JSON.stringify(lesson)).not.toMatch(/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/u);
    }
    expect(arc[0]?.storyData.nextEpisodeHook).toContain('outdated poster');
    expect(arc[0]?.missionData2.topics.map((topic: any) => topic.title)).toEqual([
      'A PLAN THAT CHANGED', 'GROUP PLANS', 'DINNER PLAN B',
    ]);
    expect(arc[0]?.missionData2.topics.every((topic: any) => topic.questions.length === 3)).toBe(true);
    expect(arc[1]?.storyData.previousSummary).toContain('leak');
    expect(arc[2]?.storyData.previousSummary).toContain('poster');
    expect(arc[3]?.storyData.currentEpisodeSummary).toContain('safe');
  });
  test('new listening scripts remain in tutor guidance and the speaking challenge is sustained', () => {
    for (const lesson of [chapter[5], chapter[8]] as any[]) {
      expect(lesson.applyData.tutorSteps.some((step: any) => step.listeningScript)).toBe(true);
      expect(lesson.missionData.tutorSteps.some((step: any) => step.listeningScript)).toBe(true);
      expect(lesson.applyData.dialogueLines).toEqual([]);
      expect(lesson.missionData.listeningScript).toBeUndefined();
    }
    const reading: any = chapter[6];
    expect(reading?.missionData.readingPassage.blocks[0].content).toContain('Gojo Art Room');
    const speaking: any = chapter[7];
    expect(speaking?.missionData.instruction).toContain('90-second message without tutor interruptions');
    expect(speaking?.missionData.tutorSteps[1].instruction).toContain('tutor speaks first');
    expect(speaking?.applyData.dialogueLines).toHaveLength(1);
  });
  test('other courses and legacy starter lessons retain their publish behavior', () => {
    expect(conversationalLessonErrors({ course: 'business-english', level: 3 })).toEqual([]);
    expect(conversationalLessonErrors({ course: 'conversational-skills', level: 1 })).toEqual([]);
  });
});
