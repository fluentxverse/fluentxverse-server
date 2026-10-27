import { createAgent } from "../agentFactory";
import { z } from 'zod';
import { getDriver } from "../../db/memgraph";
import { tryIssueAndMaybeSubmitTutorCertificationProof } from "../proof.services/tutorCertificationWorkflow.service";
import {
  ApplicationError,
  WRITTEN_PASS,
  MAX_ATTEMPTS,
  attemptCutoff,
  deadline,
  failGeneration,
  generateValidatedAssessment,
  lockApplicant,
  publishGeneratedExam,
  repairPassedFlag,
  reserveGeneration,
  retireMalformedAttempt,
  validateAnswers,
  validateWrittenContent,
} from "./applicationPolicy";
import type { ExamResult, WrittenExam } from "./exam.interface";
import { writtenInstructions, writtenReviewInstructions, writtenReviewSchemaForCount,
  writtenReviewInput, finalizeWrittenReview,
  WRITTEN_QUALITY_VERSION, WRITTEN_MODEL, WrittenQualityError, writtenAuthorSchema, writtenAuthorRepairSchema,
  normalizeWrittenAuthor, mergeWrittenAuthorRepairs, parseWrittenReviews, shuffleWrittenOptions } from './writtenQuality';
export type * from "./exam.interface";

const generator = createAgent({
  name: "Written Exam Generator",
  model: WRITTEN_MODEL,
  defaultOptions: { modelSettings: { temperature: 0.2 } },
  instructions: writtenInstructions,
});
const reviewer = createAgent({ name: 'Written Exam Quality Reviewer', model: WRITTEN_MODEL,
  defaultOptions: { modelSettings: { temperature: 0 } }, instructions: writtenReviewInstructions });

export async function generateReviewedWrittenContent() {
  let candidate: ReturnType<typeof normalizeWrittenAuthor> | undefined;
  let draft: z.infer<typeof writtenAuthorSchema> | undefined;
  let failedIds: number[] = [], feedback = '';
  let reviewerNotes: unknown[] = [];
  const reviews = new Map<number, ReturnType<typeof parseWrittenReviews>[number]>();
  return generateValidatedAssessment(async (signal, attempt) => {
    try {
      if (draft && failedIds.length) {
        const response = await generator.generate('Repair ONLY the supplied questions. Return {questions:[...]} with the same IDs/types and four distinct options. Rewrite the context/options to remove the identified defects. Do not return an answer key or change the passages. ' +
          JSON.stringify({ passages: draft.passages, questions: draft.questions.filter(q => failedIds.includes(q.id)), defects: feedback, reviewerNotes }),
          { abortSignal: signal, structuredOutput: { schema: writtenAuthorRepairSchema } });
        draft = mergeWrittenAuthorRepairs(draft, response.object, failedIds);
        candidate = normalizeWrittenAuthor(draft);
      } else {
        reviews.clear(); reviewerNotes = [];
        const response = await generator.generate('Generate a new 30-question assessment. Validate every completed sentence.' +
          (attempt ? ' Previous validation feedback: ' + feedback : ''),
          { abortSignal: signal, structuredOutput: { schema: writtenAuthorSchema } });
        draft = writtenAuthorSchema.parse(response.object);
        candidate = normalizeWrittenAuthor(draft);
      }
      const pending = candidate.questions.filter(q => !reviews.has(q.id) || failedIds.includes(q.id));
      const review = await reviewer.generate(writtenReviewInput({ ...candidate, questions: pending }),
        { abortSignal: signal, structuredOutput: { schema: writtenReviewSchemaForCount(pending.length) } });
      const checked = parseWrittenReviews(review.object, pending);
      for (const item of checked) reviews.set(item.id, item);
      reviewerNotes = checked.filter(item => item.issue !== 'none' || item.validOptions.length !== 1);
      return shuffleWrittenOptions(finalizeWrittenReview(candidate, { reviews: [...reviews.values()] }));
    } catch (error) {
      if (error instanceof WrittenQualityError) {
        feedback = error.feedback;
        if (error.questionIds.length) failedIds = error.questionIds;
        else { draft = undefined; failedIds = []; reviews.clear(); }
      } else if (error instanceof z.ZodError && draft) {
        failedIds = [...new Set(error.issues.flatMap(issue => issue.path[0] === 'questions' && typeof issue.path[1] === 'number'
          ? [draft!.questions[issue.path[1]]!.id] : []))];
        feedback = 'Repair the flagged questions: four distinct options and exactly one blank per sentence.';
        if (!failedIds.length) draft = undefined;
      }
      throw error;
    }
  }, 90000, 4);
}

export async function generateWrittenExam(
  tutorId: string,
): Promise<WrittenExam> {
  await checkAndAutoSubmitExpiredExam(tutorId);
  const reservation = await reserveGeneration(tutorId, "written");
  if (reservation.existing) return attachProgress(reservation.existing);
  try {
    const content = await generateReviewedWrittenContent();
    const exam = {
      ...content,
      examId: reservation.id,
      timeLimit: 25,
      passingScore: WRITTEN_PASS,
      qualityPolicy: WRITTEN_QUALITY_VERSION,
      createdAt: new Date().toISOString(),
    } as WrittenExam;
    await publishGeneratedExam(tutorId, "written", reservation.claim, exam);
    return (await getActiveExam(tutorId))!;
  } catch (error) {
    console.error("[application] Written generation failed", JSON.stringify({
      kind: error instanceof Error ? error.name : "Unknown",
      status: typeof (error as any)?.statusCode === "number" ? (error as any).statusCode : undefined,
      issues: Array.isArray((error as any)?.issues)
        ? (error as any).issues.map((issue: any) => ({ path: issue.path, code: issue.code }))
        : undefined,
    }));
    await failGeneration(reservation.id, reservation.claim);
    throw error;
  }
}

function attachProgress(
  node: Record<string, any>,
): WrittenExam & { savedAnswers?: number[]; currentQuestion?: number } {
  return {
    ...JSON.parse(node.content),
    startedAt: node.startedAt,
    savedAnswers: node.savedAnswers ? JSON.parse(node.savedAnswers) : undefined,
    currentQuestion: node.currentQuestion ?? 0,
  };
}
export function getExamForClient(
  exam: WrittenExam & { savedAnswers?: number[]; currentQuestion?: number },
) {
  return {
    ...exam,
    questions: exam.questions.map(({ correctAnswer, ...question }) => question),
  };
}

export async function saveExamAnswers(
  examId: string,
  tutorId: string,
  answers: number[],
  currentQuestion: number,
): Promise<boolean> {
  const session = getDriver().session();
  try {
    return await session.executeWrite(async (tx) => {
      await lockApplicant(tx, tutorId, false, true);
      const node = (
        await tx.run(
          "MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {id:$examId,type:'written',status:'active'}) RETURN e",
          { tutorId, examId },
        )
      ).records[0]?.get("e").properties;
      if (!node)
        throw new ApplicationError(409, "No active written attempt found.");
      const exam: WrittenExam = JSON.parse(node.content);
      if (Date.now() >= deadline(node, exam.timeLimit))
        throw new ApplicationError(
          409,
          "Assessment time has expired. Submit to view your saved result.",
        );
      const valid = validateAnswers(answers, exam.questions.length);
      if (
        !Number.isInteger(currentQuestion) ||
        currentQuestion < 0 ||
        currentQuestion >= exam.questions.length
      )
        throw new ApplicationError(400, "Invalid question position.");
      await tx.run(
        "MATCH(e:Exam {id:$examId}) SET e.savedAnswers=$answers,e.currentQuestion=$currentQuestion,e.lastSavedAt=$now",
        {
          examId,
          answers: JSON.stringify(valid),
          currentQuestion,
          now: new Date().toISOString(),
        },
      );
      return true;
    });
  } finally {
    await session.close();
  }
}

export async function gradeExam(
  examId: string,
  tutorId: string,
  answers: number[],
): Promise<ExamResult> {
  await retireMalformedAttempt(tutorId, "written");
  const session = getDriver().session();
  try {
    const result = await session.executeWrite(async (tx) => {
      await lockApplicant(tx, tutorId, false, true);
      const node = (
        await tx.run(
          "MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {id:$examId,type:'written'}) RETURN e",
          { tutorId, examId },
        )
      ).records[0]?.get("e").properties;
      if (!node) throw new ApplicationError(404, "Written attempt not found.");
      if (node.status === "completed") {
        await repairPassedFlag(tx, tutorId, "written");
        return JSON.parse(node.result) as ExamResult;
      }
      if (node.status !== "active")
        throw new ApplicationError(
          409,
          "Assessment is not available for submission.",
        );
      const exam: WrittenExam = JSON.parse(node.content);
      // Legacy malformed attempts cannot be promoted to a passing result.
      validateWrittenContent(exam);
      const submitted = validateAnswers(answers, exam.questions.length);
      const accepted =
        Date.now() >= deadline(node, exam.timeLimit)
          ? validateAnswers(
              node.savedAnswers ? JSON.parse(node.savedAnswers) : [],
              exam.questions.length,
            )
          : submitted;
      const sectionScores = {
        grammar: { correct: 0, total: 0 },
        vocabulary: { correct: 0, total: 0 },
        comprehension: { correct: 0, total: 0 },
      };
      const graded = exam.questions.map((q, index) => {
        const selectedAnswer = accepted[index]!,
          isCorrect = selectedAnswer === q.correctAnswer;
        sectionScores[q.type].total++;
        if (isCorrect) sectionScores[q.type].correct++;
        return {
          questionId: q.id,
          selectedAnswer,
          correctAnswer: q.correctAnswer,
          isCorrect,
        };
      });
      const score = graded.filter((a) => a.isCorrect).length,
        totalQuestions = exam.questions.length;
      const percentage = Math.round((score * 100) / totalQuestions);
      const result: ExamResult = {
        examId,
        tutorId,
        score,
        totalQuestions,
        percentage,
        passed: score * 100 >= WRITTEN_PASS * totalQuestions,
        sectionScores,
        answers: graded,
        completedAt: new Date().toISOString(),
      };
      await tx.run(
        "MATCH(e:Exam {id:$examId}) SET e.status='completed',e.result=$result,e.completedAt=$at",
        { examId, result: JSON.stringify(result), at: result.completedAt },
      );
      if (result.passed)
        await tx.run(
          "MATCH(u:User {id:$tutorId}) SET u.writtenExamPassed=true,u.writtenExamScore=$percentage,u.writtenExamPassedAt=$at",
          { tutorId, percentage, at: result.completedAt },
        );
      return result;
    });
    if (result.passed)
      void tryIssueAndMaybeSubmitTutorCertificationProof(
        tutorId,
        "written_exam_passed",
      );
    return result;
  } finally {
    await session.close();
  }
}

export async function getExamStatus(
  tutorId: string,
  examType: "written" | "speaking" = "written",
) {
  const session = getDriver().session();
  try {
    return await session.executeWrite(async (tx) => {
      const user = await lockApplicant(tx, tutorId);
      await repairPassedFlag(tx, tutorId, examType);
      const rows = (
        await tx.run(
          "MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {type:$examType}) RETURN e ORDER BY e.createdAt DESC",
          { tutorId, examType },
        )
      ).records.map((r) => r.get("e").properties);
      const completed = rows.filter((e) => e.status === "completed");
      const passed = completed.find(
        (e) => JSON.parse(e.result).passed === true,
      );
      const latest = passed || rows[0],
        result =
          latest?.status === "completed" ? JSON.parse(latest.result) : null;
      const userPassed =
        user[
          examType === "written" ? "writtenExamPassed" : "speakingExamPassed"
        ] === true;
      return {
        hasActiveExam: !passed && !userPassed && latest?.status === "active",
        hasCompletedExam: !!result || userPassed,
        passed: result?.passed ?? (userPassed ? true : null),
        percentage:
          result?.[examType === "written" ? "percentage" : "overallScore"] ??
          user[
            examType === "written" ? "writtenExamScore" : "speakingExamScore"
          ] ??
          null,
        examId: latest?.id ?? null,
        attemptsThisMonth: completed.filter(
          (e) =>
            e.completedAt >= attemptCutoff() &&
            JSON.parse(e.result).passed === false,
        ).length,
        maxAttemptsPerMonth: MAX_ATTEMPTS,
        attemptWindowDays: 30,
        state: latest?.status ?? "not_started",
        isProcessing: ["queued", "processing"].includes(latest?.status),
        gradingFailed: latest?.status === "grading_failed",
        canRetryGrading:
          latest?.status === "grading_failed" &&
          (latest.manualRetries ?? 0) < 1,
      };
    });
  } finally {
    await session.close();
  }
}

export async function getActiveExam(
  tutorId: string,
  examType: "written" | "speaking" = "written",
): Promise<WrittenExam | null> {
  await retireMalformedAttempt(tutorId, examType);
  const session = getDriver().session();
  try {
    const node = (
      await session.run(
        "MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {type:$examType,status:'active'}) RETURN e ORDER BY e.createdAt DESC LIMIT 1",
        { tutorId, examType },
      )
    ).records[0]?.get("e").properties;
    return node ? attachProgress(node) : null;
  } finally {
    await session.close();
  }
}

export async function checkAndAutoSubmitExpiredExam(
  tutorId: string,
  examType: "written" | "speaking" = "written",
): Promise<{ expired: boolean; result?: ExamResult; canRetake?: boolean }> {
  if (examType !== "written")
    throw new ApplicationError(400, "Written assessment required.");
  const exam = await getActiveExam(tutorId);
  if (!exam || Date.now() < deadline(exam, exam.timeLimit))
    return { expired: false };
  const result = await gradeExam(exam.examId, tutorId, []);
  const status = await getExamStatus(tutorId);
  return {
    expired: true,
    result,
    canRetake: !result.passed && status.attemptsThisMonth < MAX_ATTEMPTS,
  };
}

export async function getExamResultWithDetails(
  tutorId: string,
  examId: string,
): Promise<{ exam: WrittenExam; result: ExamResult } | null> {
  const session = getDriver().session();
  try {
    const node = (
      await session.run(
        "MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {id:$examId,type:'written',status:'completed'}) RETURN e",
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
