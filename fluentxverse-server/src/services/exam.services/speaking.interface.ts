// ============================================================================
// SPEAKING EXAM TYPES & INTERFACES
// ============================================================================

// -----------------------------------------------------------------------------
// Task Types
// -----------------------------------------------------------------------------

export interface ReadAloudTask {
  id: number;
  type: "read-aloud";
  instruction: string;
  sentence: string; // The sentence to read aloud
  timeLimit: number; // seconds (typically 30s)
}

export interface PictureDescriptionTask {
  id: number;
  type: "picture-description";
  instruction: string;
  imageUrl: string; // URL to the image
  imageDescription: string; // Hidden description for AI grading context
  timeLimit: number; // seconds (typically 60s)
}

export interface SituationalResponseTask {
  id: number;
  type: "situational-response";
  instruction: string;
  scenario: string; // The situation/context
  prompt: string; // What the user should respond to
  expectedTopics: string[]; // Key points AI should look for
  timeLimit: number; // seconds (typically 45s)
}

export interface TeachingDemoTask {
  id: number;
  type: "teaching-demo";
  instruction: string;
  topic: string; // e.g., "Explain the difference between 'since' and 'for'"
  targetLevel: "beginner" | "intermediate" | "advanced";
  keyPoints: string[]; // Points the explanation should cover
  timeLimit: number; // seconds (typically 90s)
}

export interface OpenResponseTask {
  id: number;
  type: "open-response";
  instruction: string;
  question: string; // The opinion/discussion question
  expectedElements: string[]; // Elements a good answer should include
  timeLimit: number; // seconds (typically 60s)
}

export type SpeakingTask =
  | ReadAloudTask
  | PictureDescriptionTask
  | SituationalResponseTask
  | TeachingDemoTask
  | OpenResponseTask;

// -----------------------------------------------------------------------------
// Exam Structure
// -----------------------------------------------------------------------------

export interface SpeakingExam {
  format?: 'read-aloud.v1';
  examId: string;
  title: string;
  description: string;
  totalTimeLimit: number; // Total exam time in minutes
  passingScore: number; // percentage (85%)
  createdAt: string;
  startedAt?: string;
  savedTaskIds?: number[];
  tasks: SpeakingTask[];
}

// -----------------------------------------------------------------------------
// Submission & Recording
// -----------------------------------------------------------------------------

export interface TaskRecording {
  taskId: number;
  audioUrl: string; // Canonical data URL; persisted encrypted, never fetched remotely
  duration: number; // Actual recording duration in seconds
  transcription?: string; // Whisper transcription (filled after processing)
}

export interface SpeakingExamSubmission {
  examId: string;
  tutorId: string;
  recordings: TaskRecording[];
  submittedAt: string;
}

// -----------------------------------------------------------------------------
// Grading & Results
// -----------------------------------------------------------------------------

export interface TaskScore {
  taskId: number;
  taskType: SpeakingTask["type"];
  transcription: string;
  scores: {
    pronunciation: number | null; // Not assessed by the transcript-only rubric
    fluency: number | null;
    vocabulary: number; // 1-5 scale
    grammar: number; // 1-5 scale
    coherence: number; // 1-5 scale
    taskCompletion: number; // 1-5 scale
  };
  averageScore: number; // Average of all scores (1-5)
  percentage: number; // Converted to percentage (0-100)
  feedback: string; // AI-generated feedback for this task
}

export interface SpeakingExamResult {
  format?: 'read-aloud.v1';
  examId: string;
  tutorId: string;
  overallScore: number; // Average percentage across all tasks
  passed: boolean; // AI content threshold only, not a final application decision
  taskScores: TaskScore[];
  sectionAverages: {
    pronunciation: number | null;
    fluency: number | null;
    vocabulary: number;
    grammar: number;
    coherence: number;
    taskCompletion: number;
  };
  overallFeedback: string; // AI-generated summary feedback
  completedAt: string;
  assessmentMode?: 'transcript-content';
  rubricVersion?: string;
  audioReviewRequired?: boolean;
  decisionStatus?: 'human_review_required';
}

// -----------------------------------------------------------------------------
// Status
// -----------------------------------------------------------------------------

export interface SpeakingExamStatus {
  hasActiveExam: boolean;
  hasCompletedExam: boolean;
  isProcessing: boolean; // true when exam is submitted but still being graded
  passed: boolean | null;
  percentage: number | null;
  examId: string | null;
  attemptsThisMonth: number;
  maxAttemptsPerMonth: number;
  state?: string;
  gradingFailed?: boolean;
  canRetryGrading?: boolean;
}

// -----------------------------------------------------------------------------
// Image Pool (for picture description)
// -----------------------------------------------------------------------------

export interface ExamImage {
  id: string;
  url: string;
  description: string; // Detailed description for AI context
  category: "classroom" | "daily-life" | "workplace" | "travel" | "social";
}
