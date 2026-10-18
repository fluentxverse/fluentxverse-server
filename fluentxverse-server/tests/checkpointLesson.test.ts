import { describe, expect, test } from 'bun:test';
import type { ClassroomExerciseMark } from '../src/services/classroomExerciseMarks.services/classroomExerciseMarks.service';
import type { LessonMaterial } from '../src/services/lessonMaterial.service';
import {
  addAvailableCheckpoints, buildCheckpointLesson, checkpointPrompt, checkpointSlot,
  sourceNumbers, studentCheckpointLesson, summarizeCheckpointEvidence, validateCheckpointContent,
} from '../src/services/checkpointLesson.service';

const lesson = (number: number, chapter = 1): LessonMaterial => ({
  id: `conversational-skills-L3-C${chapter}-${number}-speaking-${number}`,
  course: 'conversational-skills', level: 3, chapter, lessonNumber: number, skill: 'speaking',
  chapterName: 'New Neighbors', lessonName: `Lesson ${number}`, goalTextEn: `Goal ${number}`,
  goalTextJp: `目標${number}`, status: 'published', createdBy: 'admin', createdByName: 'Admin',
  createdAt: '', updatedAt: '', backgroundImage: '', overlayColor: '', levelBadge: 'BEGINNER',
  chapterLabel: 'Chapter 1', lessonTitle: `Lesson ${number}`,
  stepBData: { stepType: 'grammar-tip', grammarTip: { stepName: '', duration: '', tutorSteps: [],
    explanations: [{ ruleText: `Rule ${number}`, ruleTranslation: `文法${number}`, examples: [{ sentence: `Example ${number}`, translation: '' }] }],
  } },
  learnData: { sectionTitle: 'LEARN', steps: [{ stepType: 'vocabulary', stepName: '', duration: '',
    partLabel: '', partTranslation: '', tutorSteps: [], vocabularyItems: [{ image: '', englishText: `Word ${number}`, translation: '' }],
  }] },
});

const content = {
  introduction: 'You are planning a community event.', introductionJp: '地域のイベントを計画しています。',
  stepA: [1, 2, 3, 4, 1, 2].map((sourceLessonNumber, index) => ({ sourceLessonNumber, sentence: `Incorrect ${index}`, answer: `Correct ${index}` })),
  stepB: [1, 2, 3, 4, 1].map((sourceLessonNumber, index) => ({ sourceLessonNumber, prompt: `Purpose ${index}`, optionA: 'Clear sentence.', optionB: 'Not clear.', answer: 'A' as const })),
  challenge1: { situation: 'Introduce your plan.', situationJp: '計画を紹介しましょう。', instruction: 'Give a short talk.', instructionJp: '短く話しましょう。', prompts: ['What is your plan?', 'Why?', 'What next?'] },
  challenge2: { situation: 'Read the event notice.', situationJp: '案内を読みましょう。', title: 'Community Event',
    passage: 'The community event starts at ten on Saturday morning. Visitors can join a short walk, then meet at the cafe for lunch. Registration is free, but lunch is not included. Please bring a water bottle and arrive early.',
    questions: [{ question: 'When does it start?', answer: 'At ten.' }, { question: 'Where is lunch?', answer: 'At the cafe.' }, { question: 'Is lunch included?', answer: 'No.' }] },
  challenge3: { situation: 'Invite a friend.', situationJp: '友人を誘いましょう。', instruction: 'Explain the event.', instructionJp: 'イベントを説明しましょう。', prompts: ['What is happening?', 'When?', 'What should I bring?'] },
};

describe('personalized checkpoint', () => {
  test('offers Lesson 5 only after all four source lessons are published', () => {
    const incomplete = [1, 2, 3].map(number => lesson(number));
    expect(addAvailableCheckpoints(incomplete)).toHaveLength(3);
    const available = addAvailableCheckpoints([...incomplete, lesson(4)]);
    expect(available.map(item => item.lessonNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(available[4]?.id).toBe('conversational-skills-L3-C1-5-review');
    expect(addAvailableCheckpoints([...incomplete, lesson(4), { ...lesson(5), skill: 'review' }])).toHaveLength(5);
  });

  test('handles both checkpoint ranges and rejects other lesson IDs', () => {
    expect(sourceNumbers(10)).toEqual([6, 7, 8, 9]);
    expect(checkpointSlot('conversational-skills-L3-C1-10-review-123')?.lessonNumber).toBe(10);
    expect(checkpointSlot('conversational-skills-L3-C1-4-speaking')).toBeNull();
  });

  test('uses balanced review with sparse evidence and ignores an old error after a correction', () => {
    const base: ClassroomExerciseMark = {
      sessionId: 'old', tutorId: 'tutor', studentId: 'student', lessonId: lesson(1).id,
      step: 'A', itemIndex: 0, itemType: 'choose', prompt: 'Where you from?', answerKey: 'Where are you from?',
      isCorrect: false, studentResponse: '', createdAt: '', updatedAt: '2026-09-01',
    };
    const evidence = summarizeCheckpointEvidence([{ ...base, sessionId: 'new', isCorrect: true, updatedAt: '2026-09-02' }, base], []);
    expect(evidence.mode).toBe('balanced');
    expect(evidence.missed).toHaveLength(0);
    expect(checkpointPrompt([1, 2, 3, 4].map(number => lesson(number)), evidence)).toContain('Do not identify or invent student weaknesses');
    const oneError = summarizeCheckpointEvidence([base], []);
    expect(oneError.mode).toBe('balanced');
    expect(checkpointPrompt([1, 2, 3, 4].map(number => lesson(number)), oneError)).not.toContain('Where you from?');
  });

  test('uses repeated observed errors for targeted practice without losing four-lesson coverage', () => {
    const marks = [1, 2].map(number => ({
      sessionId: `session-${number}`, tutorId: 'tutor', studentId: 'student', lessonId: lesson(number).id,
      step: 'A' as const, itemIndex: 0, itemType: 'change', prompt: `Wrong ${number}`,
      answerKey: `Correct ${number}`, isCorrect: false, studentResponse: '', createdAt: '', updatedAt: `2026-09-0${number}`,
    }));
    const evidence = summarizeCheckpointEvidence(marks, []);
    expect(evidence.mode).toBe('targeted');
    const prompt = checkpointPrompt([1, 2, 3, 4].map(number => lesson(number)), evidence);
    expect(prompt).toContain('Wrong 1');
    expect(prompt).toContain('cover every lesson');
  });

  test('rejects exercises that omit a source lesson or contain HTML', () => {
    expect(() => validateCheckpointContent({ ...content, stepA: content.stepA.filter(item => item.sourceLessonNumber !== 4) }, [1, 2, 3, 4])).toThrow();
    expect(() => validateCheckpointContent({ ...content, challenge1: { ...content.challenge1, situation: '<script>alert(1)</script>' } }, [1, 2, 3, 4])).toThrow();
    expect(() => validateCheckpointContent({ ...content, stepA: content.stepA.map(item => ({ ...item, answer: item.sentence })) }, [1, 2, 3, 4])).toThrow();
  });

  test('builds three challenges and retains the fixed feedback rubric', () => {
    const slot = checkpointSlot('conversational-skills-L3-C1-5-review')!;
    const material = buildCheckpointLesson(slot, [1, 2, 3, 4].map(number => lesson(number)), validateCheckpointContent(content, [1, 2, 3, 4]));
    expect(material.missionData?.missionType).toBe('speaking');
    expect(material.missionData2?.missionType).toBe('reading');
    expect(material.missionData3?.challengeNumber).toBe(3);
    expect(material.feedbackData?.rubricLevels.map((level: { score: number }) => level.score)).toEqual([4, 3, 2, 1]);
    expect(material.stepBData?.grammarTip?.explanations).toHaveLength(4);
    const student = studentCheckpointLesson(material);
    expect(student.exerciseData?.answers).toEqual([]);
    expect((student.exerciseData as any)?.stepBTutorSteps).toEqual([]);
    expect(student.missionData2?.tutorSteps).toEqual([]);
    expect(material.exerciseData?.answers).toHaveLength(6);
  });
});
