// ============================================================================
// EXAM TYPES & INTERFACES
// ============================================================================

export interface GrammarQuestion {
  id: number;
  type: "grammar";
  sentence: string; // Sentence with _____ blank
  options: [string, string, string, string]; // A, B, C, D
  correctAnswer: 0 | 1 | 2 | 3; // Index of correct option
}

export interface VocabularyQuestion {
  id: number;
  type: "vocabulary";
  sentence: string; // Sentence with _____ blank
  options: [string, string, string, string]; // A, B, C, D
  correctAnswer: 0 | 1 | 2 | 3;
}

export interface ComprehensionQuestion {
  id: number;
  type: "comprehension";
  passageId: number; // Reference to which passage this belongs to
  question: string;
  options: [string, string, string, string];
  correctAnswer: 0 | 1 | 2 | 3;
}

export interface ComprehensionPassage {
  id: number;
  title: string;
  content: string; // The article/story text
}

export type ExamQuestion = GrammarQuestion | VocabularyQuestion | ComprehensionQuestion;

export interface WrittenExam {
  examId: string;
  title: string;
  description: string;
  timeLimit: number; // in minutes
  passingScore: number; // percentage (e.g., 90)
  createdAt: string;
  startedAt?: string; // When the exam was started (for calculating remaining time)
  passages: ComprehensionPassage[]; // Reading passages for comprehension section
  questions: ExamQuestion[];
}

export interface ExamSubmission {
  examId: string;
  tutorId: string;
  answers: number[]; // Array of selected answer indices (0-3) for each question
  submittedAt: string;
}

export interface ExamResult {
  examId: string;
  tutorId: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  passed: boolean;
  sectionScores: {
    grammar: { correct: number; total: number };
    vocabulary: { correct: number; total: number };
    comprehension: { correct: number; total: number };
  };
  answers: {
    questionId: number;
    selectedAnswer: number;
    correctAnswer: number;
    isCorrect: boolean;
  }[];
  completedAt: string;
}

export interface ExamStatus {
  hasActiveExam: boolean;
  hasCompletedExam: boolean;
  passed: boolean | null;
  percentage: number | null;
  examId: string | null;
  attemptsThisMonth: number;
  maxAttemptsPerMonth: number;
}
