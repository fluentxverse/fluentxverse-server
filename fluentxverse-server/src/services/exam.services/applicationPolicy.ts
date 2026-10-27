import { randomUUID } from "node:crypto";
import { type ManagedTransaction } from "neo4j-driver";
import { z } from "zod";
import { getDriver } from "../../db/memgraph";
import { tutorEmailVerified } from '../auth.services/tutorEmailPolicy';
import type { WrittenExam } from "./exam.interface";
import type { SpeakingExam } from "./speaking.interface";

export const WRITTEN_PASS = 90;
export const SPEAKING_PASS = 85;
export const MAX_ATTEMPTS = 2;
export const ATTEMPT_WINDOW = 30 * 86400_000;
export const GENERATION_LEASE = 180_000;
export class ApplicationError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function applicationFailure(error: unknown) {
  if (error instanceof ApplicationError)
    return { status: error.status, message: error.message };
  if (
    /conflict|serialization|constraint.*violat|violat.*constraint/i.test(
      String((error as any)?.message),
    )
  )
    return {
      status: 409,
      message: "Application changed concurrently. Please retry.",
    };
  return {
    status: 503,
    message:
      "Assessment service is temporarily unavailable. Your progress is saved.",
  };
}
export const attemptCutoff = (now = Date.now()) =>
  new Date(now - ATTEMPT_WINDOW).toISOString();
export function parseModelJson(text: string): unknown {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(clean);
}
export async function generateValidatedAssessment<T>(
  generate: (signal: AbortSignal, attempt: number) => Promise<T>,
  budgetMs = 90000,
  maxAttempts = 3,
): Promise<T> {
  const signal = AbortSignal.timeout(budgetMs);
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const result = await generate(signal, attempt);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      const invalidOutput = error instanceof z.ZodError || error instanceof SyntaxError ||
        (error instanceof Error && error.message.startsWith("Structured output validation failed:"));
      if (!invalidOutput || attempt >= maxAttempts - 1 || signal.aborted) throw error;
    }
  }
}
const text = z.string().trim().min(1).max(12000);
const options = z
  .array(text).length(4)
  .refine(
    (values) => new Set(values.map((v) => v.toLowerCase())).size === 4,
    "Options must be distinct",
  );
const base = {
  id: z.number().int().min(1).max(30),
  options,
  correctAnswer: z.number().int().min(0).max(3),
};
export const writtenSchema = z
  .object({
    title: text,
    description: text,
    passages: z
      .array(
        z.object({
          id: z.number().int().positive(),
          title: text,
          content: text,
        }),
      )
      .min(1)
      .max(2),
    questions: z
      .array(
        z.discriminatedUnion("type", [
          z.object({ ...base, type: z.literal("grammar"), sentence: text }),
          z.object({ ...base, type: z.literal("vocabulary"), sentence: text }),
          z.object({
            ...base,
            type: z.literal("comprehension"),
            passageId: z.number().int().positive(),
            question: text,
          }),
        ]),
      )
      .length(30),
  })
  .superRefine((exam, ctx) => {
    const ids = new Set(exam.questions.map((q) => q.id)),
      passages = new Set(exam.passages.map((p) => p.id));
    if (
      ids.size !== 30 ||
      passages.size !== exam.passages.length ||
      ["grammar", "vocabulary", "comprehension"].some(
        (type) => exam.questions.filter((q) => q.type === type).length !== 10,
      ) ||
      exam.questions.some(
        (q) => q.type === "comprehension" && !passages.has(q.passageId),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid written exam structure",
      });
  });
export function validateWrittenContent(value: unknown) {
  return writtenSchema.parse(value);
}
const taskBase = {
  id: z.number().int().min(1).max(10),
  instruction: text,
  timeLimit: z.number().int().min(15).max(120),
};
export const speakingSchema = z
  .object({
    title: text,
    description: text,
    tasks: z
      .array(
        z.discriminatedUnion("type", [
          z.object({
            ...taskBase,
            type: z.literal("read-aloud"),
            sentence: text,
          }),
          z.object({
            ...taskBase,
            type: z.literal("picture-description"),
            imageUrl: text,
            imageDescription: text,
          }),
          z.object({
            ...taskBase,
            type: z.literal("situational-response"),
            scenario: text,
            prompt: text,
            expectedTopics: z.array(text).min(1).max(10),
          }),
          z.object({
            ...taskBase,
            type: z.literal("teaching-demo"),
            topic: text,
            targetLevel: z.enum(["beginner", "intermediate", "advanced"]),
            keyPoints: z.array(text).min(1).max(10),
          }),
          z.object({
            ...taskBase,
            type: z.literal("open-response"),
            question: text,
            expectedElements: z.array(text).min(1).max(10),
          }),
        ]),
      )
      .length(10),
  })
  .superRefine((exam, ctx) => {
    const expected = {
      "read-aloud": 3,
      "picture-description": 2,
      "situational-response": 2,
      "teaching-demo": 2,
      "open-response": 1,
    };
    if (
      new Set(exam.tasks.map((t) => t.id)).size !== 10 ||
      (!exam.tasks.every(t => t.type === 'read-aloud') && Object.entries(expected).some(
        ([type, count]) =>
          exam.tasks.filter((t) => t.type === type).length !== count,
      ))
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid speaking task structure",
      });
  });
export function validateSpeakingContent(value: unknown) {
  return speakingSchema.parse(value);
}
export function validateAnswers(value: unknown, count: number): number[] {
  if (
    !Array.isArray(value) ||
    value.length > count ||
    value.some((v) => !Number.isInteger(v) || v < -1 || v > 3)
  )
    throw new ApplicationError(
      400,
      "Answers must be option indices from 0 to 3, or -1 for unanswered.",
    );
  return [...value, ...Array(count - value.length).fill(-1)];
}
export function deadline(node: Record<string, any>, minutes: number) {
  const start = Date.parse(node.startedAt || node.createdAt || "");
  if (
    !Number.isFinite(start) ||
    !Number.isInteger(minutes) ||
    minutes < 1 ||
    minutes > 60
  )
    throw new ApplicationError(409, "Assessment timing requires review.");
  return start + minutes * 60000;
}
let schema: Promise<void> | undefined;
export function ensureApplicationSchema() {
  return (schema ||= (async () => {
    const s = getDriver().session();
    try {
      for (const [label, property] of [
        ["Exam", "id"],
        ["SpeakingRecording", "id"],
      ]) {
        const exists = async () =>
          (await s.run("SHOW CONSTRAINT INFO")).records.some(
            (r) =>
              r.get("constraint type") === "unique" &&
              r.get("label") === label &&
              JSON.stringify(r.get("properties")) ===
                JSON.stringify([property]),
          );
        if (!(await exists())) {
          try {
            await s.run(
              `CREATE CONSTRAINT ON (n:${label}) ASSERT n.${property} IS UNIQUE`,
            );
          } catch {
            if (!(await exists()))
              throw Error("Assessment uniqueness constraints are required");
          }
        }
      }
    } finally {
      await s.close();
    }
  })().catch((e) => {
    schema = undefined;
    throw e;
  }));
}
export async function lockApplicant(
  tx: ManagedTransaction,
  tutorId: string,
  system = false,
  requireVerifiedEmail = false,
) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(tutorId))
    throw new ApplicationError(400, "Invalid applicant identifier.");
  const row = (
    await tx.run(
      "MATCH(u:User {id:$tutorId}) SET u.applicationRevision=coalesce(u.applicationRevision,0)+1 RETURN u",
      { tutorId },
    )
  ).records[0];
  if (!row) throw new ApplicationError(404, "Applicant not found.");
  const u = row.get("u").properties;
  if (u.role && u.role !== "tutor")
    throw new ApplicationError(403, "Tutor account required.");
  if (!system && Date.parse(u.suspendedUntil || "") > Date.now())
    throw new ApplicationError(403, "This account is suspended.");
  if (!system && requireVerifiedEmail && !tutorEmailVerified(u))
    throw new ApplicationError(403, 'Confirm your email address before continuing your tutor assessment.');
  return u;
}
export async function repairPassedFlag(
  tx: ManagedTransaction,
  tutorId: string,
  type: "written" | "speaking",
) {
  const rows = (
    await tx.run(
      `MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {type:$type,status:'completed'}) RETURN e ORDER BY e.completedAt DESC`,
      { tutorId, type },
    )
  ).records;
  for (const row of rows) {
    try {
      const e = row.get("e").properties,
        r = JSON.parse(e.result),
        score = type === "written" ? r.percentage : r.overallScore;
      if (
        r.tutorId !== tutorId ||
        r.examId !== e.id ||
        r.passed !== true ||
        !Number.isInteger(score) ||
        score < (type === "written" ? WRITTEN_PASS : SPEAKING_PASS) ||
        score > 100
      )
        continue;
      await tx.run(
        `MATCH(u:User {id:$tutorId}) SET u.${type === "written" ? "written" : "speaking"}ExamPassed=true,
        u.${type === "written" ? "written" : "speaking"}ExamScore=$score,u.${type === "written" ? "written" : "speaking"}ExamPassedAt=$at`,
        { tutorId, score, at: r.completedAt },
      );
      return true;
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
    }
  }
  return false;
}
export async function reserveGeneration(
  tutorId: string,
  type: "written" | "speaking",
) {
  await ensureApplicationSchema();
  const s = getDriver().session();
  try {
    return await s.executeWrite(async (tx) => {
      const u = await lockApplicant(tx, tutorId, false, true);
      if (
        type === "speaking" &&
        u.writtenExamPassed !== true &&
        !(await repairPassedFlag(tx, tutorId, "written"))
      )
        throw new ApplicationError(
          409,
          "Pass the written exam before starting the speaking assessment.",
        );
      if (
        u[type === "written" ? "writtenExamPassed" : "speakingExamPassed"] ===
          true ||
        (await repairPassedFlag(tx, tutorId, type))
      )
        throw new ApplicationError(
          409,
          "You have already passed this assessment.",
        );
      const rows = (
        await tx.run(
          `MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {type:$type}) WHERE NOT e.status IN ['completed','generation_failed','invalidated'] RETURN e ORDER BY e.createdAt DESC LIMIT 1`,
          { tutorId, type },
        )
      ).records;
      const existing = rows[0]?.get("e").properties;
      if (existing && existing.status !== "generating")
        return { existing, id: existing.id as string, claim: "" };
      if (
        existing &&
        Date.parse(existing.generationLeaseUntil || "") > Date.now()
      )
        throw new ApplicationError(
          409,
          "Your assessment is being prepared. Please retry shortly.",
        );
      const attempts = (
        await tx.run(
          `MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {type:$type,status:'completed'}) WHERE e.completedAt >= $cutoff RETURN e`,
          { tutorId, type, cutoff: attemptCutoff() },
        )
      ).records.filter((r) => {
        try {
          return JSON.parse(r.get("e").properties.result).passed === false;
        } catch {
          return false;
        }
      }).length;
      if (attempts >= MAX_ATTEMPTS)
        throw new ApplicationError(
          409,
          "You have used both attempts in the last 30 days.",
        );
      const generationKey =
        type === "written" ? "writtenGenerationAt" : "speakingGenerationAt";
      if (Date.parse(u[generationKey] || "") > Date.now() - 30000)
        throw new ApplicationError(
          429,
          "Please wait 30 seconds before requesting another assessment.",
        );
      await tx.run(`MATCH(u:User {id:$tutorId}) SET u.${generationKey}=$now`, {
        tutorId,
        now: new Date().toISOString(),
      });
      const id =
          existing?.id ||
          `${type === "written" ? "EXAM" : "SPEAK"}-${randomUUID()}`,
        claim = randomUUID(),
        now = new Date().toISOString();
      await tx.run(
        `MATCH(u:User {id:$tutorId}) MERGE(e:Exam {id:$id})
        SET e.type=$type,e.status='generating',e.createdAt=coalesce(e.createdAt,$now),e.generationId=$claim,e.generationLeaseUntil=$lease
        MERGE(u)-[:TAKES]->(e)`,
        {
          tutorId,
          id,
          type,
          now,
          claim,
          lease: new Date(Date.now() + GENERATION_LEASE).toISOString(),
        },
      );
      return { existing: null, id: id as string, claim };
    });
  } finally {
    await s.close();
  }
}
export async function retireMalformedAttempt(
  tutorId: string,
  type: "written" | "speaking",
) {
  const s = getDriver().session();
  try {
    await s.executeWrite(async (tx) => {
      await lockApplicant(tx, tutorId);
      const rows = await tx.run(
        "MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {type:$type,status:'active'}) RETURN e",
        { tutorId, type },
      );
      for (const row of rows.records) {
        const node = row.get("e").properties;
        try {
          const content = JSON.parse(node.content);
          if (type === "written") validateWrittenContent(content);
          else {
            const oral = validateSpeakingContent(content);
            if (
              oral.tasks.some(
                (t) =>
                  t.type === "picture-description" &&
                  t.imageUrl.startsWith("/assets/exam/"),
              )
            )
              throw Error("Legacy picture files are missing");
          }
          deadline(
            node,
            type === "written" ? content.timeLimit : content.totalTimeLimit,
          );
        } catch {
          await tx.run(
            "MATCH(e:Exam {id:$id}) SET e.status='invalidated',e.invalidationReason='invalid_structure_or_timing',e.invalidatedAt=$now",
            { id: node.id, now: new Date().toISOString() },
          );
        }
      }
    });
  } finally {
    await s.close();
  }
}
export async function publishGeneratedExam(
  tutorId: string,
  type: string,
  claim: string,
  exam: WrittenExam | SpeakingExam,
) {
  const s = getDriver().session();
  try {
    await s.executeWrite(async (tx) => {
      await lockApplicant(tx, tutorId, false, true);
      const now = new Date().toISOString();
      const rows = await tx.run(
        `MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {id:$id,type:$type,status:'generating',generationId:$claim})
        SET e.status='active',e.content=$content,e.startedAt=$now,e.expiresAt=$expiresAt,e.generationLeaseUntil=null RETURN e`,
        {
          tutorId,
          id: exam.examId,
          type,
          claim,
          content: JSON.stringify({ ...exam, startedAt: now }),
          now,
          expiresAt: new Date(
            Date.parse(now) +
              ("timeLimit" in exam ? exam.timeLimit : exam.totalTimeLimit) *
                60000,
          ).toISOString(),
        },
      );
      if (!rows.records.length)
        throw new ApplicationError(
          409,
          "Assessment generation was superseded. Please reload.",
        );
    });
  } finally {
    await s.close();
  }
}
export async function failGeneration(id: string, claim: string) {
  const s = getDriver().session();
  try {
    await s.run(
      "MATCH(e:Exam {id:$id,status:'generating',generationId:$claim}) SET e.status='generation_failed'",
      { id, claim },
    );
  } finally {
    await s.close();
  }
}
