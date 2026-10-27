import { z } from "zod";
import { createAgent } from "../agentFactory";
import { getDriver } from "../../db/memgraph";
import { getExamStatus } from "./exam.service";
import {
  ApplicationError,
  SPEAKING_PASS,
  failGeneration,
  generateValidatedAssessment,
  publishGeneratedExam,
  reserveGeneration,
  retireMalformedAttempt,
} from "./applicationPolicy";
import { speakingInstructions, speakingGradingInstructions, readAloudGradingInstructions, READ_ALOUD_FORMAT, READ_ALOUD_RUBRIC, newSpeakingSchema, normalizeNewSpeakingContent } from './speakingQuality';
import { sealPrivateEvidence } from "../screening/storage";
import type {
  SpeakingExam,
  SpeakingTask,
  SpeakingExamResult,
  TaskScore,
  SpeakingExamStatus,
} from "./speaking.interface";
export type * from "./speaking.interface";

export const ORAL_RUBRIC = "transcript-content.v2";
export const CONTENT_DIMENSIONS = [
  "vocabulary",
  "grammar",
  "coherence",
  "taskCompletion",
] as const;
const generator = createAgent({
  name: "Speaking Exam Generator",
  model: "openai/gpt-4o",
  instructions: speakingInstructions,
});

const grader = createAgent({
  name: "Speaking Content Grader",
  model: "openai/gpt-4o",
  instructions: speakingGradingInstructions,
});
const readAloudGrader = createAgent({
  name: 'Read Aloud Content Grader', model: 'openai/gpt-4o', instructions: readAloudGradingInstructions,
});
const score = z.number().int().min(1).max(5);
const gradeSchema = z
  .object({
    scores: z
      .object({
        vocabulary: score,
        grammar: score,
        coherence: score,
        taskCompletion: score,
      })
      .strict(),
    feedback: z.string().trim().min(1).max(2000),
  })
  .strict();

export async function generateSpeakingExam(
  tutorId: string,
): Promise<SpeakingExam> {
  try {
    sealPrivateEvidence(Buffer.alloc(0), "oral-storage-configuration-check");
  } catch {
    throw new ApplicationError(
      503,
      "Private recording storage is not configured. Please contact support.",
    );
  }
  await retireMalformedAttempt(tutorId, "speaking");
  const reservation = await reserveGeneration(tutorId, "speaking");
  if (reservation.existing) {
    if (reservation.existing.status !== "active")
      throw new ApplicationError(
        409,
        "Your submitted assessment is awaiting grading.",
      );
    return (await getActiveSpeakingExam(tutorId))!;
  }
  try {
    const content = await generateValidatedAssessment(async (signal, attempt) => {
      const response = await generator.generate("Generate all ten tasks." +
        (attempt ? " The previous output failed validation. Recheck all required fields, unique IDs, time limits and the exact task-type distribution." : ""), {
        abortSignal: signal,
        structuredOutput: { schema: newSpeakingSchema },
      });
      return normalizeNewSpeakingContent(response.object);
    });
    const tasks = content.tasks;
    const exam: SpeakingExam = {
      ...content,
      tasks,
      examId: reservation.id,
      passingScore: SPEAKING_PASS,
      totalTimeLimit:
        Math.ceil(tasks.reduce((sum, t) => sum + t.timeLimit, 0) / 60) + 10,
      createdAt: new Date().toISOString(),
    };
    await publishGeneratedExam(tutorId, "speaking", reservation.claim, exam);
    return (await getActiveSpeakingExam(tutorId))!;
  } catch (error) {
    await failGeneration(reservation.id, reservation.claim);
    throw error;
  }
}

export function getSpeakingExamForClient(exam: SpeakingExam) {
  return {
    ...exam,
    tasks: exam.tasks.map((task) => {
      const {
        expectedTopics,
        keyPoints,
        expectedElements,
        imageDescription,
        ...publicTask
      } = task as SpeakingTask & Record<string, unknown>;
      return publicTask;
    }),
  };
}

export async function transcribeAudio(
  audio: Buffer,
  mime = "audio/webm",
): Promise<string> {
  if (!process.env.OPENAI_API_KEY)
    throw new Error("Transcription provider is not configured");
  const form = new FormData(),
    extension = mime.split("/")[1]!.split(";")[0];
  form.append(
    "file",
    new Blob([audio], { type: mime }),
    `recording.${extension}`,
  );
  form.append("model", "whisper-1");
  form.append("language", "en");
  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok)
    throw new Error(`Transcription provider returned ${response.status}`);
  const result = (await response.json()) as { text?: unknown };
  if (typeof result.text !== "string" || result.text.length > 20000)
    throw new Error("Invalid transcription response");
  return result.text.trim();
}

export async function gradeTask(
  task: SpeakingTask,
  transcription: string,
): Promise<TaskScore> {
  if (!transcription.trim())
    return {
      taskId: task.id,
      taskType: task.type,
      transcription: "",
      scores: {
        pronunciation: null,
        fluency: null,
        vocabulary: 0,
        grammar: 0,
        coherence: 0,
        taskCompletion: 0,
      },
      averageScore: 0,
      percentage: 0,
      feedback: "No speech was transcribed for this task.",
    };
  const response = await (task.type === 'read-aloud' ? readAloudGrader : grader).generate(
    JSON.stringify({ task, candidateTranscript: transcription }),
    { abortSignal: AbortSignal.timeout(60000), structuredOutput: { schema: gradeSchema } },
  );
  return parseTaskGrade(task, transcription, response.object);
}
export function parseTaskGrade(
  task: SpeakingTask,
  transcription: string,
  value: unknown,
): TaskScore {
  const result = gradeSchema.parse(value);
  const averageScore =
    CONTENT_DIMENSIONS.reduce((sum, name) => sum + result.scores[name], 0) / 4;
  return {
    taskId: task.id,
    taskType: task.type,
    transcription,
    scores: { ...result.scores, pronunciation: null, fluency: null },
    averageScore,
    percentage: Math.round(averageScore * 20),
    feedback: result.feedback,
  };
}
export function summarizeSpeaking(
  exam: SpeakingExam,
  tutorId: string,
  taskScores: TaskScore[],
): SpeakingExamResult {
  if (
    taskScores.length !== exam.tasks.length ||
    new Set(taskScores.map((t) => t.taskId)).size !== exam.tasks.length ||
    taskScores.some((t) => !exam.tasks.some((task) => task.id === t.taskId))
  )
    throw new Error("Incomplete task grades");
  // Integer credential scores must never round a sub-threshold average into a pass.
  const overallScore = Math.floor(
    taskScores.reduce((sum, t) => sum + t.percentage, 0) / taskScores.length,
  );
  const sectionAverages = {
    pronunciation: null,
    fluency: null,
    ...Object.fromEntries(
      CONTENT_DIMENSIONS.map((name) => [
        name,
        Math.round(
          (taskScores.reduce((sum, t) => sum + t.scores[name], 0) /
            taskScores.length) *
            100,
        ) / 100,
      ]),
    ),
  } as SpeakingExamResult["sectionAverages"];
  return {
    examId: exam.examId,
    tutorId,
    overallScore,
    passed: overallScore >= SPEAKING_PASS,
    taskScores,
    sectionAverages,
    assessmentMode: "transcript-content",
    rubricVersion: exam.format === READ_ALOUD_FORMAT ? READ_ALOUD_RUBRIC : ORAL_RUBRIC,
    ...(exam.format === READ_ALOUD_FORMAT ? { format: READ_ALOUD_FORMAT } : {}),
    audioReviewRequired: true,
    decisionStatus: 'human_review_required',
    overallFeedback:
      overallScore >= SPEAKING_PASS
        ? "The provisional AI content score meets the screening threshold. This is not a final application decision. Human review of pronunciation, delivery and teaching readiness is still required."
        : "The provisional AI content score is below the screening threshold. This is not a final rejection. Human review is required before a final application decision; contact support to discuss your assessment.",
    completedAt: new Date().toISOString(),
  };
}

export async function getSpeakingExamStatus(
  tutorId: string,
): Promise<SpeakingExamStatus> {
  return getExamStatus(tutorId, "speaking");
}
export async function getActiveSpeakingExam(
  tutorId: string,
): Promise<SpeakingExam | null> {
  await retireMalformedAttempt(tutorId, "speaking");
  const session = getDriver().session();
  try {
    const node = (
      await session.run(
        "MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {type:'speaking',status:'active'}) RETURN e ORDER BY e.createdAt DESC LIMIT 1",
        { tutorId },
      )
    ).records[0]?.get("e").properties;
    if (!node) return null;
    const rows = await session.run(
      "MATCH(e:Exam {id:$examId})-[:HAS_RECORDING]->(r:SpeakingRecording) RETURN r.taskId AS taskId",
      { examId: node.id },
    );
    return {
      ...JSON.parse(node.content),
      startedAt: node.startedAt || node.createdAt,
      savedTaskIds: rows.records.map((r) => Number(r.get("taskId"))),
    };
  } finally {
    await session.close();
  }
}
export async function getSpeakingExamResult(
  tutorId: string,
  examId: string,
): Promise<{ exam: SpeakingExam; result: SpeakingExamResult } | null> {
  const session = getDriver().session();
  try {
    const node = (
      await session.run(
        "MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {id:$examId,type:'speaking',status:'completed'}) RETURN e",
        { tutorId, examId },
      )
    ).records[0]?.get("e").properties;
    return node
      ? { exam: JSON.parse(node.content), result: JSON.parse(node.result) }
      : null;
  } finally {
    await session.close();
  }
}
