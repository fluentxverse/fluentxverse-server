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
  examId: string;
  title: string;
  description: string;
  totalTimeLimit: number; // Total exam time in minutes
  passingScore: number; // percentage (85%)
  createdAt: string;
  tasks: SpeakingTask[];
}

// -----------------------------------------------------------------------------
// Submission & Recording
// -----------------------------------------------------------------------------

export interface TaskRecording {
  taskId: number;
  audioUrl: string; // URL to uploaded audio file
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
    pronunciation: number; // 1-5 scale
    fluency: number; // 1-5 scale
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
  examId: string;
  tutorId: string;
  overallScore: number; // Average percentage across all tasks
  passed: boolean;
  taskScores: TaskScore[];
  sectionAverages: {
    pronunciation: number;
    fluency: number;
    vocabulary: number;
    grammar: number;
    coherence: number;
    taskCompletion: number;
  };
  overallFeedback: string; // AI-generated summary feedback
  completedAt: string;
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

// Default image pool (can be expanded)
export const EXAM_IMAGE_POOL: ExamImage[] = [
  {
    id: "img-001",
    url: "/assets/exam/classroom-discussion.jpg",
    description: "A diverse group of adult students in a modern classroom, engaged in a lively discussion. A teacher stands at a whiteboard with English vocabulary words. Some students are raising hands, others are taking notes.",
    category: "classroom",
  },
  {
    id: "img-002",
    url: "/assets/exam/coffee-shop-meeting.jpg",
    description: "Two professionals having a business meeting at a coffee shop. Laptops are open, coffee cups on the table, one person is explaining something with hand gestures while the other listens attentively.",
    category: "workplace",
  },
  {
    id: "img-003",
    url: "/assets/exam/airport-scene.jpg",
    description: "A busy international airport terminal with travelers from various backgrounds. People are checking departure boards, pulling luggage, and some are greeting arriving passengers.",
    category: "travel",
  },
  {
    id: "img-004",
    url: "/assets/exam/family-dinner.jpg",
    description: "A multi-generational family gathered around a dinner table, sharing a meal. Various dishes on the table, people engaged in conversation, warm lighting suggesting evening time.",
    category: "daily-life",
  },
  {
    id: "img-005",
    url: "/assets/exam/office-presentation.jpg",
    description: "A young professional giving a presentation to colleagues in a modern office meeting room. A large screen shows graphs and charts, audience members are seated around a conference table.",
    category: "workplace",
  },
];
