import { createAgent } from "../agentFactory";
import { getDriver } from "../../db/memgraph";
import { tryIssueAndMaybeSubmitTutorCertificationProof } from "../proof.services/tutorCertificationWorkflow.service";
import type {
  ComprehensionPassage,
  ExamQuestion,
  ExamResult,
  WrittenExam,
} from "./exam.interface";

// Re-export types for consumers
export type {
  GrammarQuestion,
  VocabularyQuestion,
  ComprehensionQuestion,
  ComprehensionPassage,
  ExamQuestion,
  WrittenExam,
  ExamSubmission,
  ExamResult,
  ExamStatus,
} from "./exam.interface";

// ============================================================================
// AI AGENT FOR EXAM GENERATION
// ============================================================================

const examGeneratorAgent = createAgent({
  name: "Written Exam Generator",
  instructions: `You are an expert ESL (English as a Second Language) exam creator for FluentXVerse.

Your task is to create a unique written proficiency exam with exactly 30 questions:
- 10 Grammar fill-in-the-blank questions
- 10 Vocabulary fill-in-the-blank questions  
- 5 Reading Comprehension questions (based on 1-2 short passages)

GRAMMAR QUESTIONS (10 total):
- Create sentences with a blank (______) where a grammar element is missing
- Test: verb tenses, subject-verb agreement, articles, prepositions, conditionals, modals, relative clauses
- Mix difficulties: 3 easy, 4 medium, 3 hard
- Example: "She ______ to the store yesterday." A) go B) goes C) went D) going

VOCABULARY QUESTIONS (10 total):
- Create sentences with a blank where a vocabulary word fits
- Test: common idioms, phrasal verbs, collocations, synonyms, context clues
- Mix difficulties: 3 easy, 4 medium, 3 hard
- Example: "The project was a complete ______; nothing went as planned." A) success B) disaster C) miracle D) routine

COMPREHENSION SECTION (5 questions from 1-2 passages):
- Write 1-2 short passages (150-250 words each) - can be a story, article, or letter
- Create 5 questions testing understanding of main idea, details, inference, vocabulary in context
- Topics: everyday situations, culture, education, travel, workplace

IMPORTANT RULES:
1. Each question has EXACTLY 4 options (A, B, C, D)
2. Only ONE correct answer per question
3. Make wrong options plausible but clearly incorrect
4. Avoid trick questions or ambiguous wording
5. Each exam should be unique - vary topics and sentence structures

Return ONLY valid JSON in this EXACT format:
{
  "title": "Written English Proficiency Exam",
  "description": "Assess your grammar, vocabulary, and reading comprehension skills",
  "passages": [
    {
      "id": 1,
      "title": "Passage title",
      "content": "The full passage text here..."
    }
  ],
  "questions": [
    {
      "id": 1,
      "type": "grammar",
      "sentence": "She ______ to the store yesterday.",
      "options": ["go", "goes", "went", "going"],
      "correctAnswer": 2
    },
    {
      "id": 11,
      "type": "vocabulary",
      "sentence": "The meeting was ______ due to bad weather.",
      "options": ["cancelled", "celebrated", "continued", "created"],
      "correctAnswer": 0
    },
    {
      "id": 21,
      "type": "comprehension",
      "passageId": 1,
      "question": "What is the main idea of the passage?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": 1
    }
  ]
}`,
  model: "openai/gpt-4o",
});

// ============================================================================
// EXAM GENERATION
// ============================================================================

/**
 * Generate a unique written exam using AI and save it to Memgraph
 * - Max 2 attempts per month if failed
 * - If already passed, no new exam allowed
 */
export const generateWrittenExam = async (tutorId: string): Promise<WrittenExam> => {
  const driver = getDriver();
  const session = driver.session();

  try {
    // Check if tutor has already passed the written exam
    const userCheck = await session.run(
      `MATCH (u:User {id: $tutorId})
       RETURN u.writtenExamPassed as passed`,
      { tutorId }
    );

    if (userCheck.records.length > 0) {
      const hasPassed = userCheck.records[0]?.get("passed");
      if (hasPassed === true) {
        throw new Error("You have already passed the written exam");
      }
    }

    // Check if tutor already has an active/incomplete exam
    const existingExam = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {type: 'written', status: 'active'})
       RETURN e`,
      { tutorId }
    );

    if (existingExam.records.length > 0) {
      // Return existing exam with startedAt
      const examNode = existingExam.records[0]?.get("e").properties;
      const examData = JSON.parse(examNode.content) as WrittenExam;
      // Attach startedAt from the node
      (examData as WrittenExam & { startedAt?: string }).startedAt = examNode.startedAt;
      return examData;
    }

    // Check attempt limit: max 2 failed attempts per month
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    
    const attemptCheck = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {type: 'written', status: 'completed'})
       WHERE e.completedAt >= $oneMonthAgo
       RETURN e`,
      { tutorId, oneMonthAgo: oneMonthAgo.toISOString() }
    );

    const failedAttemptsThisMonth = attemptCheck.records.filter((record) => {
      const examNode = record.get("e").properties;
      if (examNode.result) {
        const result = JSON.parse(examNode.result);
        return result.passed === false;
      }
      return false;
    }).length;

    if (failedAttemptsThisMonth >= 2) {
      throw new Error("You have reached the maximum of 2 exam attempts this month. Please try again next month.");
    }

    // Generate new exam with AI
    
    const prompt = `Generate a unique written English proficiency exam.
Tutor ID: ${tutorId}
Timestamp: ${new Date().toISOString()}

Create 30 questions total:
- Questions 1-10: Grammar (fill-in-the-blank)
- Questions 11-20: Vocabulary (fill-in-the-blank)
- Questions 21-25: Reading Comprehension (with 1-2 passages)

Make this exam unique by varying the topics, sentence structures, and difficulty levels.`;

    const response = await examGeneratorAgent.generate(prompt);

    // Parse the JSON response
    let examData: { title: string; description: string; passages: ComprehensionPassage[]; questions: ExamQuestion[] };
    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      examData = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("Failed to parse exam JSON:", parseError);
      console.error("Raw response:", response.text);
      throw new Error("Failed to generate valid exam structure");
    }

    // Create the exam object
    const exam: WrittenExam = {
      examId: `EXAM-${tutorId}-${Date.now()}`,
      title: examData.title || "Written English Proficiency Exam",
      description: examData.description || "Assess your grammar, vocabulary, and reading comprehension skills",
      timeLimit: 25, // 25 minutes for 30 questions
      passingScore: 90, // 27 out of 30 questions (90%)
      createdAt: new Date().toISOString(),
      passages: examData.passages || [],
      questions: examData.questions || [],
    };

    // Validate question count
    if (exam.questions.length !== 30) {
      console.warn(`Expected 30 questions, got ${exam.questions.length}. Proceeding anyway.`);
    }

    // Save exam to Memgraph - link to existing User node (tutor)
    const startedAt = new Date().toISOString();
    await session.run(
      `MATCH (u:User {id: $tutorId})
       CREATE (e:Exam {
         id: $examId,
         type: 'written',
         status: 'active',
         content: $content,
         createdAt: $createdAt,
         startedAt: $startedAt
       })
       CREATE (u)-[:TAKES]->(e)
       RETURN e`,
      {
        tutorId,
        examId: exam.examId,
        content: JSON.stringify(exam),
        createdAt: exam.createdAt,
        startedAt,
      }
    );

    return exam;

  } finally {
    await session.close();
  }
};

// ============================================================================
// GET EXAM FOR CLIENT (without answers)
// ============================================================================

/**
 * Get exam for client - removes correct answers, includes startedAt for timer calculation
 */
export const getExamForClient = (exam: WrittenExam & { savedAnswers?: number[] }) => {
  return {
    examId: exam.examId,
    title: exam.title,
    description: exam.description,
    timeLimit: exam.timeLimit,
    passingScore: exam.passingScore,
    startedAt: exam.startedAt, // Include for client to calculate remaining time
    savedAnswers: exam.savedAnswers, // Include saved answers for resume
    passages: exam.passages,
    questions: exam.questions.map((q) => {
      // Remove correctAnswer from the response
      const { correctAnswer, ...questionWithoutAnswer } = q;
      return questionWithoutAnswer;
    }),
  };
};

// ============================================================================
// SAVE ANSWERS (Server-side persistence)
// ============================================================================

/**
 * Save user's current answers to server (for resume functionality)
 */
export const saveExamAnswers = async (
  examId: string,
  tutorId: string,
  answers: number[],
  currentQuestion: number
): Promise<boolean> => {
  const driver = getDriver();
  const session = driver.session();

  try {
    await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {id: $examId, status: 'active'})
       SET e.savedAnswers = $answers,
           e.currentQuestion = $currentQuestion,
           e.lastSavedAt = $lastSavedAt
       RETURN e`,
      {
        tutorId,
        examId,
        answers: JSON.stringify(answers),
        currentQuestion,
        lastSavedAt: new Date().toISOString(),
      }
    );
    return true;
  } catch (error) {
    console.error("Failed to save exam answers:", error);
    return false;
  } finally {
    await session.close();
  }
};

// ============================================================================
// GRADE EXAM (No AI needed - deterministic grading)
// ============================================================================

/**
 * Grade an exam submission against stored answers
 */
export const gradeExam = async (
  examId: string,
  tutorId: string,
  answers: number[]
): Promise<ExamResult> => {
  const driver = getDriver();
  const session = driver.session();

  try {
    // Fetch the exam from Memgraph
    const result = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {id: $examId})
       RETURN e`,
      { tutorId, examId }
    );

    if (result.records.length === 0) {
      throw new Error("Exam not found");
    }

    const examNode = result.records[0]?.get("e").properties;
    if (examNode.type !== 'written') throw new Error('Invalid written exam attempt');
    if (examNode.status === 'completed') return JSON.parse(examNode.result) as ExamResult;
    if (examNode.status !== 'active') throw new Error('Exam is not available for submission');
    const exam: WrittenExam = JSON.parse(examNode.content);

    // Pad answers array to match question count (unanswered = -1 = wrong)
    const paddedAnswers = [...answers];
    while (paddedAnswers.length < exam.questions.length) {
      paddedAnswers.push(-1); // Unanswered questions are marked as -1 (wrong)
    }

    // Grade each question (unanswered questions are automatically wrong)
    let totalCorrect = 0;
    const sectionScores = {
      grammar: { correct: 0, total: 0 },
      vocabulary: { correct: 0, total: 0 },
      comprehension: { correct: 0, total: 0 },
    };

    const answerResults = exam.questions.map((q, index) => {
      const selectedAnswer = paddedAnswers[index] ?? -1;
      const isCorrect = selectedAnswer >= 0 && selectedAnswer === q.correctAnswer;
      
      if (isCorrect) totalCorrect++;

      // Track section scores
      if (q.type === "grammar") {
        sectionScores.grammar.total++;
        if (isCorrect) sectionScores.grammar.correct++;
      } else if (q.type === "vocabulary") {
        sectionScores.vocabulary.total++;
        if (isCorrect) sectionScores.vocabulary.correct++;
      } else if (q.type === "comprehension") {
        sectionScores.comprehension.total++;
        if (isCorrect) sectionScores.comprehension.correct++;
      }

      return {
        questionId: q.id,
        selectedAnswer,
        correctAnswer: q.correctAnswer,
        isCorrect,
      };
    });

    const percentage = Math.round((totalCorrect / exam.questions.length) * 100);
    const passed = percentage >= exam.passingScore;

    const examResult: ExamResult = {
      examId,
      tutorId,
      score: totalCorrect,
      totalQuestions: exam.questions.length,
      percentage,
      passed,
      sectionScores,
      answers: answerResults,
      completedAt: new Date().toISOString(),
    };

    // Update exam status and save result in Memgraph
    const saved = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {id: $examId, status: 'active', type: 'written'})
       SET e.status = 'completed',
           e.result = $result,
           e.completedAt = $completedAt
       RETURN e`,
      {
        tutorId,
        examId,
        result: JSON.stringify(examResult),
        completedAt: examResult.completedAt,
      }
    );

    if (!saved.records.length) throw new Error('Exam already submitted');

    // If passed, update the User node with the flag
    if (passed) {
      await session.run(
        `MATCH (u:User {id: $tutorId})
         SET u.writtenExamPassed = true,
             u.writtenExamPassedAt = $completedAt,
             u.writtenExamScore = $percentage
         RETURN u`,
        {
          tutorId,
          completedAt: examResult.completedAt,
          percentage: examResult.percentage,
        }
      );

      void tryIssueAndMaybeSubmitTutorCertificationProof(tutorId, "written_exam_passed");
    }

    return examResult;

  } finally {
    await session.close();
  }
};

// ============================================================================
// GET EXAM STATUS
// ============================================================================

/**
 * Check if a tutor has completed a specific exam type
 * Also returns attempt count for the current month
 */
export const getExamStatus = async (
  tutorId: string,
  examType: "written" | "speaking" = "written"
): Promise<{
  hasActiveExam: boolean;
  hasCompletedExam: boolean;
  passed: boolean | null;
  percentage: number | null;
  examId: string | null;
  attemptsThisMonth: number;
  maxAttemptsPerMonth: number;
}> => {
  const driver = getDriver();
  const session = driver.session();

  try {
    // Check if user has already passed (from User node flag)
    const userCheck = await session.run(
      `MATCH (u:User {id: $tutorId})
       RETURN u.writtenExamPassed as passed, u.writtenExamScore as score`,
      { tutorId }
    );

    if (userCheck.records.length > 0) {
      const hasPassed = userCheck.records[0]?.get("passed");
      const score = userCheck.records[0]?.get("score");
      if (hasPassed === true) {
        return {
          hasActiveExam: false,
          hasCompletedExam: true,
          passed: true,
          percentage: score || 100,
          examId: null,
          attemptsThisMonth: 0,
          maxAttemptsPerMonth: 2,
        };
      }
    }

    // Count failed attempts this month
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    
    const attemptCheck = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {type: $examType, status: 'completed'})
       WHERE e.completedAt >= $oneMonthAgo
       RETURN e`,
      { tutorId, examType, oneMonthAgo: oneMonthAgo.toISOString() }
    );

    const attemptsThisMonth = attemptCheck.records.filter((record) => {
      const examNode = record.get("e").properties;
      if (examNode.result) {
        const result = JSON.parse(examNode.result);
        return result.passed === false;
      }
      return false;
    }).length;

    // Get latest exam
    const result = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {type: $examType})
       RETURN e
       ORDER BY e.createdAt DESC
       LIMIT 1`,
      { tutorId, examType }
    );

    if (result.records.length === 0) {
      return {
        hasActiveExam: false,
        hasCompletedExam: false,
        passed: null,
        percentage: null,
        examId: null,
        attemptsThisMonth,
        maxAttemptsPerMonth: 2,
      };
    }

    const examNode = result.records[0]?.get("e").properties;
    const isCompleted = examNode.status === "completed";

    if (isCompleted && examNode.result) {
      const examResult: ExamResult = JSON.parse(examNode.result);
      return {
        hasActiveExam: false,
        hasCompletedExam: true,
        passed: examResult.passed,
        percentage: examResult.percentage,
        examId: examNode.id,
        attemptsThisMonth,
        maxAttemptsPerMonth: 2,
      };
    }

    return {
      hasActiveExam: true,
      hasCompletedExam: false,
      passed: null,
      percentage: null,
      examId: examNode.id,
      attemptsThisMonth,
      maxAttemptsPerMonth: 2,
    };

  } finally {
    await session.close();
  }
};

// ============================================================================
// GET ACTIVE EXAM
// ============================================================================

/**
 * Get an active (incomplete) exam for a tutor
 */
export const getActiveExam = async (
  tutorId: string,
  examType: "written" | "speaking" = "written"
): Promise<WrittenExam | null> => {
  const driver = getDriver();
  const session = driver.session();

  try {
    const result = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {type: $examType, status: 'active'})
       RETURN e`,
      { tutorId, examType }
    );

    if (result.records.length === 0) {
      return null;
    }

    const examNode = result.records[0]?.get("e").properties;
    const exam = JSON.parse(examNode.content) as WrittenExam;
    
    // Attach server-side data
    exam.startedAt = examNode.startedAt;
    
    // Attach saved answers if available
    if (examNode.savedAnswers) {
      (exam as WrittenExam & { savedAnswers?: number[]; currentQuestion?: number }).savedAnswers = 
        JSON.parse(examNode.savedAnswers);
      (exam as WrittenExam & { savedAnswers?: number[]; currentQuestion?: number }).currentQuestion = 
        examNode.currentQuestion || 0;
    }
    
    return exam;

  } finally {
    await session.close();
  }
};

// ============================================================================
// CHECK AND AUTO-SUBMIT EXPIRED EXAM
// ============================================================================

/**
 * Check if an active exam has expired and auto-submit if so
 * Returns the result if auto-submitted, null if still active or no exam
 */
export const checkAndAutoSubmitExpiredExam = async (
  tutorId: string,
  examType: "written" | "speaking" = "written"
): Promise<{ expired: boolean; result?: ExamResult; canRetake?: boolean }> => {
  const driver = getDriver();
  const session = driver.session();

  try {
    const result = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {type: $examType, status: 'active'})
       RETURN e`,
      { tutorId, examType }
    );

    if (result.records.length === 0) {
      return { expired: false };
    }

    const examNode = result.records[0]?.get("e").properties;
    const exam = JSON.parse(examNode.content) as WrittenExam;
    const startedAt = new Date(examNode.startedAt).getTime();
    const now = Date.now();
    const elapsedSeconds = Math.floor((now - startedAt) / 1000);
    const totalSeconds = exam.timeLimit * 60;

    // Check if exam has expired
    if (elapsedSeconds >= totalSeconds) {
      
      // Get saved answers or empty array
      const savedAnswers = examNode.savedAnswers 
        ? JSON.parse(examNode.savedAnswers) 
        : new Array(exam.questions.length).fill(-1);
      
      // Grade the exam with saved answers
      await session.close(); // Close this session before calling gradeExam
      const examResult = await gradeExam(exam.examId, tutorId, savedAnswers);
      
      // Check if user can retake
      const status = await getExamStatus(tutorId, examType);
      const canRetake = !examResult.passed && status.attemptsThisMonth < status.maxAttemptsPerMonth;
      
      return { 
        expired: true, 
        result: examResult,
        canRetake,
      };
    }

    // Exam still active
    return { expired: false };

  } finally {
    await session.close();
  }
};

// ============================================================================
// GET EXAM RESULT WITH DETAILS
// ============================================================================

/**
 * Get detailed exam result (for review after submission)
 */
export const getExamResultWithDetails = async (
  tutorId: string,
  examId: string
): Promise<{ exam: WrittenExam; result: ExamResult } | null> => {
  const driver = getDriver();
  const session = driver.session();

  try {
    const dbResult = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {id: $examId, status: 'completed'})
       RETURN e`,
      { tutorId, examId }
    );

    if (dbResult.records.length === 0) {
      return null;
    }

    const examNode = dbResult.records[0]?.get("e").properties;
    const exam: WrittenExam = JSON.parse(examNode.content);
    const result: ExamResult = JSON.parse(examNode.result);

    return { exam, result };

  } finally {
    await session.close();
  }
};

export default {
  generateWrittenExam,
  getExamForClient,
  saveExamAnswers,
  gradeExam,
  getExamStatus,
  getActiveExam,
  checkAndAutoSubmitExpiredExam,
  getExamResultWithDetails,
};
