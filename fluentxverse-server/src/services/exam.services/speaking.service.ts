import { createAgent } from "../agentFactory";
import { getDriver } from "../../db/memgraph";
import { randomUUID } from 'node:crypto';
import { decodeSubmittedAudio, transcribeBoundRecording } from '../screening/evidence';
import { savePrivateAudio } from '../screening/storage';
import { tryIssueAndMaybeSubmitTutorCertificationProof } from "../proof.services/tutorCertificationWorkflow.service";
import type {
  SpeakingExam,
  SpeakingTask,
  SpeakingExamResult,
  TaskScore,
  TaskRecording,
  SpeakingExamStatus,
} from "./speaking.interface";
import { EXAM_IMAGE_POOL } from "./speaking.interface";

// Re-export types
export type {
  ReadAloudTask,
  PictureDescriptionTask,
  SituationalResponseTask,
  TeachingDemoTask,
  OpenResponseTask,
  SpeakingTask,
  SpeakingExam,
  TaskRecording,
  SpeakingExamSubmission,
  TaskScore,
  SpeakingExamResult,
  SpeakingExamStatus,
  ExamImage,
} from "./speaking.interface";

// ============================================================================
// CONSTANTS
// ============================================================================

const PASSING_SCORE = 85; // 85% to pass
const MAX_ATTEMPTS_PER_MONTH = 2;

// ============================================================================
// AI AGENTS
// ============================================================================

/**
 * Agent for generating unique speaking exam tasks
 */
const speakingExamGeneratorAgent = createAgent({
  name: "Speaking Exam Generator",
  instructions: `You are an expert ESL speaking exam creator for FluentXVerse tutor certification.

Your task is to create a unique speaking proficiency exam with exactly 10 tasks:
- 3 Read Aloud sentences (varied difficulty and topics)
- 2 Picture Description prompts (describing images)
- 2 Situational Response scenarios (teaching-related situations)
- 2 Teaching Demonstrations (explain grammar/vocabulary concepts)
- 1 Open Response question (opinion/discussion about teaching)

READ ALOUD TASKS (3 total):
- Create natural, flowing sentences (15-25 words each)
- Mix: 1 simple, 1 intermediate, 1 complex sentence
- Include varied phonemes, intonation patterns, and stress points
- Topics: education, daily life, professional contexts

PICTURE DESCRIPTION TASKS (2 total):
- Create prompts asking to describe what they see in an image
- The actual image will be injected separately
- Focus on: people, actions, setting, emotions, possible story
- Example prompt: "Describe what you see in this image. Include details about the people, the setting, and what might be happening."

SITUATIONAL RESPONSE TASKS (2 total):
- Create realistic ESL teaching scenarios
- Example: "A student keeps making the same mistake. How do you address this?"
- Include context and a clear prompt for response

TEACHING DEMO TASKS (2 total):
- Ask to explain grammar points or vocabulary concepts
- Vary target levels (beginner, intermediate, advanced)
- Example: "Explain the difference between 'make' and 'do' to a beginner student"

OPEN RESPONSE TASKS (1 total):
- Opinion questions about teaching methodology
- Example: "What is the most effective way to build a student's confidence in speaking?"

Return ONLY valid JSON in this EXACT format:
{
  "title": "Speaking Proficiency Exam",
  "description": "Demonstrate your English speaking and teaching abilities",
  "tasks": [
    {
      "id": 1,
      "type": "read-aloud",
      "instruction": "Read the following sentence clearly and naturally.",
      "sentence": "The conference attendees discussed various approaches to sustainable development.",
      "timeLimit": 30
    },
    {
      "id": 4,
      "type": "picture-description",
      "instruction": "Look at the image and describe what you see in detail.",
      "imageUrl": "PLACEHOLDER",
      "imageDescription": "PLACEHOLDER",
      "timeLimit": 60
    },
    {
      "id": 6,
      "type": "situational-response",
      "instruction": "Listen to the scenario and respond appropriately.",
      "scenario": "You are teaching an online class and a student's microphone stops working.",
      "prompt": "What would you say and do to handle this situation?",
      "expectedTopics": ["alternative communication", "patience", "problem-solving"],
      "timeLimit": 45
    },
    {
      "id": 8,
      "type": "teaching-demo",
      "instruction": "Explain this concept as if teaching a student.",
      "topic": "Explain the difference between 'since' and 'for' when talking about time",
      "targetLevel": "intermediate",
      "keyPoints": ["since = point in time", "for = duration", "examples of each"],
      "timeLimit": 90
    },
    {
      "id": 10,
      "type": "open-response",
      "instruction": "Share your thoughts on the following question.",
      "question": "What strategies do you use to help shy students participate more in class?",
      "expectedElements": ["encouragement techniques", "safe environment", "gradual exposure"],
      "timeLimit": 60
    }
  ]
}`,
  model: "openai/gpt-4o",
});

/**
 * Agent for grading speaking responses using transcriptions
 */
const speakingGraderAgent = createAgent({
  name: "Speaking Exam Grader",
  instructions: `You are an expert ESL speaking evaluator for FluentXVerse.

You will receive:
1. The original task (what the candidate was asked to do)
2. The transcription of the candidate's spoken response

Grade the response on these 6 criteria (1-5 scale each):

PRONUNCIATION (1-5):
- 5: Native-like clarity, natural stress and intonation
- 4: Clear with minor issues, easily understood
- 3: Understandable but noticeable non-native patterns
- 2: Frequent errors affecting comprehension
- 1: Very difficult to understand

FLUENCY (1-5):
- 5: Smooth, natural pace with appropriate pausing
- 4: Generally fluent with occasional hesitation
- 3: Noticeable pauses or filler words, but maintains flow
- 2: Frequent pauses, choppy delivery
- 1: Very hesitant, fragmented speech

VOCABULARY (1-5):
- 5: Rich, precise vocabulary appropriate to context
- 4: Good range with minor imprecision
- 3: Adequate vocabulary, some repetition
- 2: Limited vocabulary affecting expression
- 1: Very basic vocabulary, unable to express ideas

GRAMMAR (1-5):
- 5: Accurate grammar with complex structures
- 4: Minor errors that don't impede communication
- 3: Some errors but message is clear
- 2: Frequent errors affecting clarity
- 1: Pervasive errors making meaning unclear

COHERENCE (1-5):
- 5: Well-organized, logical flow of ideas
- 4: Clear organization with minor issues
- 3: Ideas connected but some jumps
- 2: Disorganized, hard to follow
- 1: No clear structure

TASK COMPLETION (1-5):
- 5: Fully addresses all aspects of the task
- 4: Addresses most aspects effectively
- 3: Partially addresses the task
- 2: Minimally addresses the task
- 1: Does not address the task

NOTE: For read-aloud tasks, focus mainly on pronunciation and fluency.
For teaching demos, weight task completion and coherence higher.

Return ONLY valid JSON:
{
  "scores": {
    "pronunciation": 4,
    "fluency": 4,
    "vocabulary": 5,
    "grammar": 4,
    "coherence": 4,
    "taskCompletion": 5
  },
  "feedback": "Your explanation was clear and well-structured. You provided good examples..."
}`,
  model: "openai/gpt-4o",
});

// ============================================================================
// EXAM GENERATION
// ============================================================================

/**
 * Generate a unique speaking exam using AI and save to Memgraph
 */
export const generateSpeakingExam = async (tutorId: string): Promise<SpeakingExam> => {
  const driver = getDriver();
  const session = driver.session();

  try {
    // Check if tutor has already passed the speaking exam
    const userCheck = await session.run(
      `MATCH (u:User {id: $tutorId})
       RETURN u.speakingExamPassed as passed`,
      { tutorId }
    );

    if (userCheck.records.length > 0) {
      const hasPassed = userCheck.records[0]?.get("passed");
      if (hasPassed === true) {
        throw new Error("You have already passed the speaking exam");
      }
    }

    // Check for active exam
    const existingExam = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {type: 'speaking', status: 'active'})
       RETURN e`,
      { tutorId }
    );

    if (existingExam.records.length > 0) {
      const examNode = existingExam.records[0]?.get("e").properties;
      return JSON.parse(examNode.content) as SpeakingExam;
    }

    // Check attempt limit
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const attemptCheck = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {type: 'speaking', status: 'completed'})
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

    if (failedAttemptsThisMonth >= MAX_ATTEMPTS_PER_MONTH) {
      throw new Error(
        `You have reached the maximum of ${MAX_ATTEMPTS_PER_MONTH} exam attempts this month. Please try again next month.`
      );
    }

    // Generate exam with AI

    const prompt = `Generate a unique speaking proficiency exam.
Tutor ID: ${tutorId}
Timestamp: ${new Date().toISOString()}

Create 10 tasks total:
- Tasks 1-3: Read Aloud (sentences to read clearly)
- Tasks 4-5: Picture Description (describe images - use PLACEHOLDER for imageUrl and imageDescription)
- Tasks 6-7: Situational Response (teaching scenarios)
- Tasks 8-9: Teaching Demonstration (explain concepts)
- Task 10: Open Response (opinion question about teaching)

Make this exam unique by varying topics, difficulty, and scenarios.`;

    const response = await speakingExamGeneratorAgent.generate(prompt);

    // Parse JSON response
    let examData: { title: string; description: string; tasks: SpeakingTask[] };
    try {
      const jsonMatch = response.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      examData = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("Failed to parse speaking exam JSON:", parseError);
      throw new Error("Failed to generate valid exam structure");
    }

    // Calculate total time limit
    const totalTimeLimit = Math.ceil(
      examData.tasks.reduce((sum, task) => sum + task.timeLimit, 0) / 60
    );

    // Inject real images for picture-description tasks
    const shuffledImages = [...EXAM_IMAGE_POOL].sort(() => Math.random() - 0.5);
    let imageIndex = 0;
    
    const tasksWithImages = examData.tasks.map((task) => {
      if (task.type === "picture-description") {
        const image = shuffledImages[imageIndex % shuffledImages.length];
        imageIndex++;
        return {
          ...task,
          imageUrl: image!.url,
          imageDescription: image!.description,
        };
      }
      return task;
    });

    // Create exam object
    const exam: SpeakingExam = {
      examId: `SPEAK-${tutorId}-${Date.now()}`,
      title: examData.title || "Speaking Proficiency Exam",
      description: examData.description || "Demonstrate your English speaking and teaching abilities",
      totalTimeLimit: totalTimeLimit + 5, // Add 5 min buffer
      passingScore: PASSING_SCORE,
      createdAt: new Date().toISOString(),
      tasks: tasksWithImages as SpeakingTask[],
    };

    // Validate task count
    if (exam.tasks.length !== 10) {
      console.warn(`Expected 10 tasks, got ${exam.tasks.length}. Proceeding anyway.`);
    }

    // Save to Memgraph
    await session.run(
      `MATCH (u:User {id: $tutorId})
       CREATE (e:Exam {
         id: $examId,
         type: 'speaking',
         status: 'active',
         content: $content,
         createdAt: $createdAt
       })
       CREATE (u)-[:TAKES]->(e)
       RETURN e`,
      {
        tutorId,
        examId: exam.examId,
        content: JSON.stringify(exam),
        createdAt: exam.createdAt,
      }
    );

    return exam;
  } finally {
    await session.close();
  }
};

// ============================================================================
// GET EXAM FOR CLIENT
// ============================================================================

/**
 * Get exam for client - removes expectedTopics/keyPoints (grading hints)
 */
export const getSpeakingExamForClient = (exam: SpeakingExam) => {
  return {
    examId: exam.examId,
    title: exam.title,
    description: exam.description,
    totalTimeLimit: exam.totalTimeLimit,
    passingScore: exam.passingScore,
    tasks: exam.tasks.map((task) => {
      // Remove grading hints from client response
      if (task.type === "situational-response") {
        const { expectedTopics, ...taskWithoutHints } = task;
        return taskWithoutHints;
      }
      if (task.type === "teaching-demo") {
        const { keyPoints, ...taskWithoutHints } = task;
        return taskWithoutHints;
      }
      if (task.type === "open-response") {
        const { expectedElements, ...taskWithoutHints } = task;
        return taskWithoutHints;
      }
      return task;
    }),
  };
};

// ============================================================================
// TRANSCRIBE AUDIO (using OpenAI Whisper)
// ============================================================================

/**
 * Transcribe audio using OpenAI Whisper API
 */
export const transcribeAudio = async (audioBuffer: Buffer): Promise<string> => {
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: "audio/webm" });
  formData.append("file", blob, "recording.webm");
  formData.append("model", "whisper-1");
  formData.append("language", "en");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Whisper API error:", error);
    throw new Error("Failed to transcribe audio");
  }

  const result = (await response.json()) as { text: string };
  return result.text;
};

// ============================================================================
// GRADE SPEAKING EXAM
// ============================================================================

/**
 * Grade a single task response
 */
const gradeTask = async (
  task: SpeakingTask,
  transcription: string
): Promise<Omit<TaskScore, "taskId" | "taskType">> => {
  // Build context for grader
  let taskContext = "";

  if (task.type === "read-aloud") {
    taskContext = `TASK: Read Aloud
Original sentence: "${task.sentence}"
Candidate's transcription: "${transcription}"

Focus on pronunciation accuracy (compare to original) and fluency.`;
  } else if (task.type === "situational-response") {
    taskContext = `TASK: Situational Response
Scenario: ${task.scenario}
Prompt: ${task.prompt}
Expected topics to cover: ${task.expectedTopics.join(", ")}

Candidate's response: "${transcription}"`;
  } else if (task.type === "teaching-demo") {
    taskContext = `TASK: Teaching Demonstration
Topic: ${task.topic}
Target student level: ${task.targetLevel}
Key points that should be covered: ${task.keyPoints.join(", ")}

Candidate's explanation: "${transcription}"`;
  } else if (task.type === "open-response") {
    taskContext = `TASK: Open Response
Question: ${task.question}
Expected elements in a good answer: ${task.expectedElements.join(", ")}

Candidate's response: "${transcription}"`;
  } else if (task.type === "picture-description") {
    taskContext = `TASK: Picture Description
Image shows: ${task.imageDescription}

Candidate's description: "${transcription}"`;
  }

  const gradePrompt = `Grade this speaking response:

${taskContext}

Provide scores (1-5) and brief feedback.`;

  const response = await speakingGraderAgent.generate(gradePrompt);

  // Parse grading response
  let gradeData: {
    scores: {
      pronunciation: number;
      fluency: number;
      vocabulary: number;
      grammar: number;
      coherence: number;
      taskCompletion: number;
    };
    feedback: string;
  };

  try {
    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON in grading response");
    }
    gradeData = JSON.parse(jsonMatch[0]);
  } catch { throw new Error('Speaking assessment returned an invalid grading response'); }

  const dimensions = ['pronunciation', 'fluency', 'vocabulary', 'grammar', 'coherence', 'taskCompletion'] as const;
  if (!gradeData.scores || Object.keys(gradeData.scores).length !== dimensions.length
    || dimensions.some(name => !Number.isFinite(gradeData.scores[name]) || gradeData.scores[name] < 1 || gradeData.scores[name] > 5)) {
    throw new Error('Speaking rubric scores must be finite values between 1 and 5');
  }

  // Calculate averages
  const scoreValues = Object.values(gradeData.scores);
  const averageScore = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;
  const percentage = Math.round((averageScore / 5) * 100);

  return {
    transcription,
    scores: gradeData.scores,
    averageScore: Math.round(averageScore * 100) / 100,
    percentage,
    feedback: gradeData.feedback,
  };
};

/**
 * Grade complete speaking exam submission
 */
export const gradeSpeakingExam = async (
  examId: string,
  tutorId: string,
  recordings: TaskRecording[]
): Promise<SpeakingExamResult> => {
  const driver = getDriver();
  const session = driver.session();
  const processingId = randomUUID();

  try {
    // Fetch exam from Memgraph
    const result = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {id: $examId})
       RETURN e`,
      { tutorId, examId }
    );

    if (result.records.length === 0) {
      throw new Error("Exam not found");
    }

    const examNode = result.records[0]?.get("e").properties;
    if (examNode.type !== 'speaking') throw new Error('Invalid speaking exam attempt');
    if (examNode.status === 'completed') return JSON.parse(examNode.result) as SpeakingExamResult;
    if (examNode.status !== 'active') throw new Error('Exam is already being graded');
    const exam: SpeakingExam = JSON.parse(examNode.content);
    if (recordings.length !== exam.tasks.length) throw new Error('A recording is required for every speaking task');
    const seen = new Set<number>();
    for (const recording of recordings) {
      if (seen.has(recording.taskId) || !exam.tasks.some(task => task.id === recording.taskId)) throw new Error('Invalid or duplicate speaking task');
      decodeSubmittedAudio(recording.audioUrl);
      seen.add(recording.taskId);
    }

    // Mark exam as "processing" so the user can see it's being graded
    const claimed = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {id: $examId, type: 'speaking', status: 'active'})
       SET e.status = 'processing',
           e.processingId = $processingId,
           e.processingStartedAt = $processingStartedAt
       RETURN e`,
      {
        tutorId,
        examId,
        processingId,
        processingStartedAt: new Date().toISOString(),
      }
    );
    if (!claimed.records.length) throw new Error('Exam is already being graded');

    // Never trust client transcripts; bind server transcription to audio bytes.
    const transcribedRecordings: TaskRecording[] = [];
    const audioEvidence: Record<string, unknown>[] = [];
    
    for (const recording of recordings) {
      const bound = await transcribeBoundRecording(tutorId, examId, recording.taskId, recording.audioUrl, transcribeAudio);
      const privateAudioRef = await savePrivateAudio(decodeSubmittedAudio(recording.audioUrl));
      audioEvidence.push({ ...bound.evidence, privateAudioRef });
      transcribedRecordings.push({ ...recording, transcription: bound.transcription });
    }
    

    // Grade each task
    const taskScores: TaskScore[] = [];
    const sectionTotals = {
      pronunciation: 0,
      fluency: 0,
      vocabulary: 0,
      grammar: 0,
      coherence: 0,
      taskCompletion: 0,
    };

    for (const task of exam.tasks) {
      const recording = transcribedRecordings.find((r) => r.taskId === task.id);

      if (!recording || !recording.transcription) {
        // No recording = 0 score
        taskScores.push({
          taskId: task.id,
          taskType: task.type,
          transcription: "",
          scores: {
            pronunciation: 0,
            fluency: 0,
            vocabulary: 0,
            grammar: 0,
            coherence: 0,
            taskCompletion: 0,
          },
          averageScore: 0,
          percentage: 0,
          feedback: "No recording submitted for this task.",
        });
        continue;
      }

      const gradeResult = await gradeTask(task, recording.transcription);

      taskScores.push({
        taskId: task.id,
        taskType: task.type,
        ...gradeResult,
      });

      // Add to section totals
      sectionTotals.pronunciation += gradeResult.scores.pronunciation;
      sectionTotals.fluency += gradeResult.scores.fluency;
      sectionTotals.vocabulary += gradeResult.scores.vocabulary;
      sectionTotals.grammar += gradeResult.scores.grammar;
      sectionTotals.coherence += gradeResult.scores.coherence;
      sectionTotals.taskCompletion += gradeResult.scores.taskCompletion;
    }

    // Calculate averages
    const taskCount = exam.tasks.length;
    const sectionAverages = {
      pronunciation: Math.round((sectionTotals.pronunciation / taskCount) * 100) / 100,
      fluency: Math.round((sectionTotals.fluency / taskCount) * 100) / 100,
      vocabulary: Math.round((sectionTotals.vocabulary / taskCount) * 100) / 100,
      grammar: Math.round((sectionTotals.grammar / taskCount) * 100) / 100,
      coherence: Math.round((sectionTotals.coherence / taskCount) * 100) / 100,
      taskCompletion: Math.round((sectionTotals.taskCompletion / taskCount) * 100) / 100,
    };

    // Overall score
    const overallScore = Math.round(
      taskScores.reduce((sum, t) => sum + t.percentage, 0) / taskCount
    );
    const passed = overallScore >= PASSING_SCORE;

    // Generate overall feedback
    const overallFeedback = passed
      ? `Congratulations! You have demonstrated strong English speaking and teaching abilities with an overall score of ${overallScore}%. Your strengths include ${
          sectionAverages.pronunciation >= 4 ? "pronunciation" : ""
        }${sectionAverages.fluency >= 4 ? ", fluency" : ""}${
          sectionAverages.taskCompletion >= 4 ? ", and task completion" : ""
        }. Welcome to FluentXVerse!`
      : `Your overall score of ${overallScore}% did not meet the passing threshold of ${PASSING_SCORE}%. Focus on improving ${
          sectionAverages.pronunciation < 3 ? "pronunciation" : ""
        }${sectionAverages.fluency < 3 ? ", fluency" : ""}${
          sectionAverages.grammar < 3 ? ", grammar" : ""
        }. You may retake the exam after reviewing these areas.`;

    const examResult: SpeakingExamResult = {
      examId,
      tutorId,
      overallScore,
      passed,
      taskScores,
      sectionAverages,
      overallFeedback,
      completedAt: new Date().toISOString(),
    };

    // Update exam in Memgraph
    const completed = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {id: $examId, status: 'processing', processingId: $processingId})
       SET e.status = 'completed',
           e.result = $result,
           e.screeningAudioEvidence = $audioEvidence,
           e.completedAt = $completedAt
       RETURN e`,
      {
        tutorId,
        examId,
        processingId,
        audioEvidence: JSON.stringify(audioEvidence),
        result: JSON.stringify(examResult),
        completedAt: examResult.completedAt,
      }
    );
    if (!completed.records.length) throw new Error('Exam grading claim was lost');

    // If passed, update User node
    if (passed) {
      await session.run(
        `MATCH (u:User {id: $tutorId})
         SET u.speakingExamPassed = true,
             u.speakingExamPassedAt = $completedAt,
             u.speakingExamScore = $score
         RETURN u`,
        {
          tutorId,
          completedAt: examResult.completedAt,
          score: examResult.overallScore,
        }
      );

      void tryIssueAndMaybeSubmitTutorCertificationProof(tutorId, "speaking_exam_passed");
    }

    return examResult;
  } catch (error) {
    await session.run(
      `MATCH (e:Exam {id: $examId, status: 'processing', processingId: $processingId}) SET e.status = 'active'`,
      { examId, processingId }
    );
    throw error;
  } finally {
    await session.close();
  }
};

// ============================================================================
// GET SPEAKING EXAM STATUS
// ============================================================================

export const getSpeakingExamStatus = async (tutorId: string): Promise<SpeakingExamStatus> => {
  const driver = getDriver();
  const session = driver.session();

  try {
    // Check if already passed
    const userCheck = await session.run(
      `MATCH (u:User {id: $tutorId})
       RETURN u.speakingExamPassed as passed, u.speakingExamScore as score`,
      { tutorId }
    );

    if (userCheck.records.length > 0) {
      const hasPassed = userCheck.records[0]?.get("passed");
      const score = userCheck.records[0]?.get("score");
      if (hasPassed === true) {
        return {
          hasActiveExam: false,
          hasCompletedExam: true,
          isProcessing: false,
          passed: true,
          percentage: score || 100,
          examId: null,
          attemptsThisMonth: 0,
          maxAttemptsPerMonth: MAX_ATTEMPTS_PER_MONTH,
        };
      }
    }

    // Count failed attempts this month
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const attemptCheck = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {type: 'speaking', status: 'completed'})
       WHERE e.completedAt >= $oneMonthAgo
       RETURN e`,
      { tutorId, oneMonthAgo: oneMonthAgo.toISOString() }
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
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {type: 'speaking'})
       RETURN e
       ORDER BY e.createdAt DESC
       LIMIT 1`,
      { tutorId }
    );

    if (result.records.length === 0) {
      return {
        hasActiveExam: false,
        hasCompletedExam: false,
        isProcessing: false,
        passed: null,
        percentage: null,
        examId: null,
        attemptsThisMonth,
        maxAttemptsPerMonth: MAX_ATTEMPTS_PER_MONTH,
      };
    }

    const examNode = result.records[0]?.get("e").properties;
    const isCompleted = examNode.status === "completed";
    const isProcessing = examNode.status === "processing";

    // If exam is being processed (submitted but not yet graded)
    if (isProcessing) {
      return {
        hasActiveExam: false,
        hasCompletedExam: false,
        isProcessing: true,
        passed: null,
        percentage: null,
        examId: examNode.id,
        attemptsThisMonth,
        maxAttemptsPerMonth: MAX_ATTEMPTS_PER_MONTH,
      };
    }

    if (isCompleted && examNode.result) {
      const examResult: SpeakingExamResult = JSON.parse(examNode.result);
      return {
        hasActiveExam: false,
        hasCompletedExam: true,
        isProcessing: false,
        passed: examResult.passed,
        percentage: examResult.overallScore,
        examId: examNode.id,
        attemptsThisMonth,
        maxAttemptsPerMonth: MAX_ATTEMPTS_PER_MONTH,
      };
    }

    return {
      hasActiveExam: true,
      hasCompletedExam: false,
      isProcessing: false,
      passed: null,
      percentage: null,
      examId: examNode.id,
      attemptsThisMonth,
      maxAttemptsPerMonth: MAX_ATTEMPTS_PER_MONTH,
    };
  } finally {
    await session.close();
  }
};

// ============================================================================
// GET ACTIVE SPEAKING EXAM
// ============================================================================

export const getActiveSpeakingExam = async (tutorId: string): Promise<SpeakingExam | null> => {
  const driver = getDriver();
  const session = driver.session();

  try {
    const result = await session.run(
      `MATCH (u:User {id: $tutorId})-[:TAKES]->(e:Exam {type: 'speaking', status: 'active'})
       RETURN e`,
      { tutorId }
    );

    if (result.records.length === 0) {
      return null;
    }

    const examNode = result.records[0]?.get("e").properties;
    return JSON.parse(examNode.content) as SpeakingExam;
  } finally {
    await session.close();
  }
};

// ============================================================================
// GET SPEAKING EXAM RESULT
// ============================================================================

export const getSpeakingExamResult = async (
  tutorId: string,
  examId: string
): Promise<{ exam: SpeakingExam; result: SpeakingExamResult } | null> => {
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
    const exam: SpeakingExam = JSON.parse(examNode.content);
    const result: SpeakingExamResult = JSON.parse(examNode.result);

    return { exam, result };
  } finally {
    await session.close();
  }
};

export default {
  generateSpeakingExam,
  getSpeakingExamForClient,
  transcribeAudio,
  gradeSpeakingExam,
  getSpeakingExamStatus,
  getActiveSpeakingExam,
  getSpeakingExamResult,
};
