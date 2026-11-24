import { expect, test } from 'bun:test';
import { buildLesson2 } from '../content/conversational-skills/ja/level-3-chapter-1/lesson-2-listening';
import { standardizeTutorGuides, withoutTutorGuides } from '../content/conversational-skills/ja/level-3-chapter-1/standardize-tutor-guides';

function fixture(number: 1 | 2) {
  const lesson: any = buildLesson2({ exerciseData: {} }, 'https://api.fluentxverse.com');
  lesson.introductionData.lessonGoalSteps = [
    { instruction: 'Introduce the lesson objective.', script: 'Original objective.' },
    { instruction: 'Introduce the situation.', script: 'Original situation.' },
    { instruction: 'Ask a warm-up question.', script: 'Original warm-up?' },
    { instruction: 'Transition.', script: 'Great!' },
  ];
  lesson.missionData.tutorSteps = [
    { instruction: 'Listen.', listeningScript: '<p>PRIVATE LISTENING SCRIPT</p>' },
    { instruction: 'Roleplay.', scripts: [{ text: '1. ORIGINAL ROLEPLAY LINE' }], prompts: [{ text: 'ORIGINAL FOLLOW-UP' }] },
  ];
  if (number === 1) {
    lesson.skill = 'speaking';
    lesson.goalTextEn = 'I can introduce myself.';
    lesson.learnData.steps[0].pronunciationPart.leftColumn.soundSymbol = '/m/';
    lesson.learnData.steps[0].pronunciationPart.rightColumn.soundSymbol = '/n/';
  }
  return lesson;
}

function reference() {
  const lesson = fixture(2);
  lesson.learnData.steps[0].tutorSteps = [
    { instruction: 'Introduce Learn.', script: "Now let's try Learn." },
    { instruction: 'Read the instructions.' },
    { instruction: 'Model the first vocabulary item.' },
    { instruction: 'Repeat with the remaining vocabulary.' },
    { instruction: 'Transition to the next part.' },
  ];
  lesson.feedbackData.tutorSteps = [
    { instruction: 'Introduce Feedback.' },
    { instruction: 'Have the student read the lesson objective.' },
    { instruction: 'Ask if they achieved the lesson objective.' },
    { instruction: 'Score Challenge 1.' },
    { instruction: 'Give range, accuracy, and fluency feedback.' },
    { instruction: 'Wrap up the lesson.' },
  ];
  return lesson;
}

for (const number of [1, 2] as const) {
  test(`Lesson ${number} follows the reference without changing student material`, () => {
    const before = fixture(number), template = reference();
    const original = structuredClone(before), originalTemplate = structuredClone(template);
    const next = standardizeTutorGuides(before, template, number);
    expect(withoutTutorGuides(next)).toEqual(withoutTutorGuides(before));
    expect(before).toEqual(original);
    expect(template).toEqual(originalTemplate);
    expect(next.introductionData.lessonGoalSteps).toHaveLength(4);
    expect(next.learnData.steps[0].tutorSteps).toHaveLength(5);
    expect(next.learnData.steps[0].discussionPart.tutorSteps).toHaveLength(5);
    expect(next.learnData.steps[0].pronunciationPart.tutorSteps).toHaveLength(5);
    expect(next.feedbackData.tutorSteps).toEqual(template.feedbackData.tutorSteps);
    expect(next.applyData.tutorSteps.flatMap((step: any) => step.questions || [])).toEqual(before.applyData.tutorSteps.flatMap((step: any) => step.questions || []));
    expect(next.exerciseData.tutorSteps.flatMap((step: any) => step.answerKey || [])).toEqual(before.exerciseData.tutorSteps.flatMap((step: any) => step.answerKey || []));
    const roleplay = next.missionData.tutorSteps.find((step: any) => step.scripts?.some((script: any) => script.text === '1. ORIGINAL ROLEPLAY LINE'));
    expect(roleplay.prompts).toEqual([{ text: 'ORIGINAL FOLLOW-UP' }]);
    expect(roleplay.instruction).toContain('tutor speaks first');
    expect(next.missionData.tutorSteps.filter((step: any) => step.listeningScript)).toHaveLength(number === 2 ? 1 : 0);
    if (number === 2) {
      expect(next.missionData.tutorSteps.find((step: any) => step.listeningScript).listeningScript).toBe('<p>PRIVATE LISTENING SCRIPT</p>');
      expect(next.exerciseData.stepBTutorSteps.flatMap((step: any) => step.scripts || [])).toEqual(before.exerciseData.stepBTutorSteps.flatMap((step: any) => step.scripts || []));
      expect(next.exerciseData.stepBTutorSteps.flatMap((step: any) => step.answerKey || [])).toEqual(before.exerciseData.stepBTutorSteps.flatMap((step: any) => step.answerKey || []));
    }
  });
}

test('missing scripts or incomplete templates refuse the update', () => {
  const lesson = fixture(2);
  lesson.missionData.tutorSteps = [];
  expect(() => standardizeTutorGuides(lesson, reference(), 2)).toThrow();
  const template = reference();
  template.feedbackData.tutorSteps = [];
  expect(() => standardizeTutorGuides(fixture(1), template, 1)).toThrow();
});
