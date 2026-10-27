import type { WrittenExam } from "../src/services/exam.services/exam.interface";
import type {
  SpeakingExam,
  SpeakingTask,
} from "../src/services/exam.services/speaking.interface";

export function writtenFixture(examId = "written-fixture"): WrittenExam {
  return {
    examId,
    title: "English assessment",
    description: "Assessment fixture",
    timeLimit: 25,
    passingScore: 90,
    createdAt: new Date().toISOString(),
    passages: [
      { id: 1, title: "A class", content: "The class starts on Monday." },
    ],
    questions: Array.from({ length: 30 }, (_, i) =>
      i < 20
        ? {
            id: i + 1,
            type: i < 10 ? ("grammar" as const) : ("vocabulary" as const),
            sentence: "The lesson ____ soon.",
            options: ["starts", "start", "starting", "started"],
            correctAnswer: 0,
          }
        : {
            id: i + 1,
            type: "comprehension" as const,
            passageId: 1,
            question: "When does the class start?",
            options: ["Monday", "Tuesday", "Wednesday", "Thursday"],
            correctAnswer: 0,
          },
    ),
  };
}
export function speakingFixture(examId = "speaking-fixture"): SpeakingExam {
  const task = (id: number): SpeakingTask => {
    const common = { id, instruction: "Respond to the task.", timeLimit: 30 };
    if (id <= 3)
      return { ...common, type: "read-aloud", sentence: "A lesson begins." };
    if (id <= 5)
      return {
        ...common,
        type: "picture-description",
        imageUrl: "PLACEHOLDER",
        imageDescription: "PLACEHOLDER",
      };
    if (id <= 7)
      return {
        ...common,
        type: "situational-response",
        scenario: "A student is shy.",
        prompt: "How do you help?",
        expectedTopics: ["encouragement"],
      };
    if (id <= 9)
      return {
        ...common,
        type: "teaching-demo",
        topic: "Explain the past tense.",
        targetLevel: "beginner",
        keyPoints: ["examples"],
      };
    return {
      ...common,
      type: "open-response",
      question: "Why teach?",
      expectedElements: ["motivation"],
    };
  };
  return {
    examId,
    title: "Oral content screening",
    description: "Assessment fixture",
    totalTimeLimit: 20,
    passingScore: 85,
    createdAt: new Date().toISOString(),
    tasks: Array.from({ length: 10 }, (_, i) => task(i + 1)),
  };
}

export function readAloudFixture(examId = 'read-aloud-fixture'): SpeakingExam {
  const sentences = [
    'The teacher helps every student feel welcome in class.',
    'We usually eat breakfast together before we leave for work.',
    'Please put your books on the table near the window.',
    'My family likes to walk in the park after dinner.',
    'The bus stops outside the school every morning.',
    'I always carry an umbrella when the weather looks cloudy.',
    'She found a quiet place to read her favorite book.',
    'We can finish this activity together before our break.',
    'Our new neighbor brought some fresh fruit to share.',
    'Thank you for helping me understand the instructions today.',
  ];
  return { ...speakingFixture(examId), format: 'read-aloud.v1', tasks: sentences.map((sentence, index) => ({
    id: index + 1, type: 'read-aloud', instruction: 'Read the sentence aloud.', sentence, timeLimit: 30,
  })) };
}
