import { randomUUID, createHash } from "node:crypto";
import type { ManagedTransaction } from "neo4j-driver";
import { getDriver } from "../../db/memgraph";
import { withAIPrivacy } from '../../privacy/aiBoundary';
import { decodeSubmittedAudio } from "../screening/evidence";
import { digest } from "../screening/policy";
import { sealPrivateEvidence, openPrivateEvidence } from "../screening/storage";
import { tryIssueAndMaybeSubmitTutorCertificationProof } from "../proof.services/tutorCertificationWorkflow.service";
import {
  ApplicationError,
  deadline,
  ensureApplicationSchema,
  lockApplicant,
} from "./applicationPolicy";
import {
  gradeTask,
  summarizeSpeaking,
  transcribeAudio,
} from "./speaking.service";
import type {
  SpeakingExam,
  SpeakingTask,
  TaskRecording,
  TaskScore,
} from "./speaking.interface";

const LEASE_MS = 120000,
  MAX_RUNS = 3;
const context = (tutorId: string, examId: string, taskId: number) =>
  `oral:${tutorId}:${examId}:${taskId}`;
async function ownedExam(
  tx: ManagedTransaction,
  tutorId: string,
  examId: string,
  system = false,
) {
  await lockApplicant(tx, tutorId, system, true);
  const node = (
    await tx.run(
      "MATCH(:User {id:$tutorId})-[:TAKES]->(e:Exam {id:$examId,type:'speaking'}) RETURN e",
      { tutorId, examId },
    )
  ).records[0]?.get("e").properties;
  if (!node) throw new ApplicationError(404, "Oral assessment not found.");
  return node;
}
export async function saveSpeakingRecording(
  tutorId: string,
  examId: string,
  recording: TaskRecording,
) {
  if (
    !Number.isInteger(recording.taskId) ||
    !Number.isFinite(recording.duration) ||
    recording.duration < 0.5 ||
    recording.duration > 125
  )
    throw new ApplicationError(400, "Invalid recording metadata.");
  let audio: Buffer;
  try {
    audio = decodeSubmittedAudio(recording.audioUrl);
  } catch {
    throw new ApplicationError(400, "Invalid or oversized audio recording.");
  }
  const id = `${examId}:${recording.taskId}`,
    aad = context(tutorId, examId, recording.taskId);
  let encrypted: string;
  try {
    encrypted = sealPrivateEvidence(
      Buffer.from(JSON.stringify({ audioUrl: recording.audioUrl })),
      aad,
    );
  } catch {
    throw new ApplicationError(
      503,
      "Private recording storage is not configured. Please contact support.",
    );
  }
  const audioHash = createHash("sha256").update(audio).digest("hex");
  await ensureApplicationSchema();
  const s = getDriver().session();
  try {
    return await s.executeWrite(async (tx) => {
      const node = await ownedExam(tx, tutorId, examId),
        exam: SpeakingExam = JSON.parse(node.content);
      const task = exam.tasks.find((t) => t.id === recording.taskId);
      if (!task || recording.duration > task.timeLimit + 5)
        throw new ApplicationError(
          400,
          "Recording does not match an assessment task.",
        );
      const prior = (
        await tx.run("MATCH(r:SpeakingRecording {id:$id}) RETURN r", { id })
      ).records[0]?.get("r").properties;
      if (prior) {
        if (prior.audioHash !== audioHash || prior.tutorId !== tutorId)
          throw new ApplicationError(
            409,
            "This task already has a saved recording.",
          );
        return { taskId: recording.taskId, saved: true };
      }
      if (node.status !== "active")
        throw new ApplicationError(
          409,
          "This assessment is already submitted.",
        );
      if (Date.now() >= deadline(node, exam.totalTimeLimit))
        throw new ApplicationError(
          409,
          "Assessment recording time has expired. Submit your saved recordings.",
        );
      await tx.run(
        `MATCH(e:Exam {id:$examId}) CREATE(r:SpeakingRecording {id:$id,taskId:$taskId,tutorId:$tutorId,
        encryptedAudio:$encrypted,audioHash:$audioHash,duration:$duration,savedAt:$now}) CREATE(e)-[:HAS_RECORDING]->(r)`,
        {
          id,
          examId,
          taskId: recording.taskId,
          tutorId,
          encrypted,
          audioHash,
          duration: recording.duration,
          now: new Date().toISOString(),
        },
      );
      return { taskId: recording.taskId, saved: true };
    });
  } finally {
    await s.close();
  }
}

export async function submitSpeakingExam(
  tutorId: string,
  examId: string,
  retry = false,
) {
  const s = getDriver().session();
  try {
    return await s.executeWrite(async (tx) => {
      const node = await ownedExam(tx, tutorId, examId),
        exam: SpeakingExam = JSON.parse(node.content);
      if (node.status === "completed")
        return { state: "completed", result: JSON.parse(node.result) };
      if (["queued", "processing"].includes(node.status))
        return { state: node.status };
      const saved = (
        await tx.run(
          "MATCH(:Exam {id:$examId})-[:HAS_RECORDING]->(r:SpeakingRecording) RETURN r",
          { examId },
        )
      ).records;
      if (node.status === "grading_failed") {
        if (!retry || (node.manualRetries ?? 0) >= 1 || !saved.length)
          throw new ApplicationError(
            409,
            "Grading requires support review. Your saved recordings have not been lost.",
          );
      } else if (node.status !== "active")
        throw new ApplicationError(
          409,
          "Assessment is not ready for submission.",
        );
      else if (
        saved.length !== exam.tasks.length &&
        Date.now() < deadline(node, exam.totalTimeLimit)
      )
        throw new ApplicationError(
          400,
          "Save a recording for every task before submitting.",
        );
      await tx.run(
        `MATCH(e:Exam {id:$examId}) SET e.status='queued',e.submittedAt=coalesce(e.submittedAt,$now),
        e.gradingRuns=0,e.nextRunAt=$now,e.manualRetries=$manualRetries,e.processingId=null,e.processingLeaseUntil=null`,
        {
          examId,
          now: new Date().toISOString(),
          manualRetries: (node.manualRetries ?? 0) + (retry ? 1 : 0),
        },
      );
      return { state: "queued" };
    });
  } finally {
    await s.close();
  }
}

export interface SpeakingProviders {
  transcribe(audio: Buffer, mime: string): Promise<string>;
  grade(task: SpeakingTask, transcript: string): Promise<TaskScore>;
}
const providers: SpeakingProviders = {
  transcribe: transcribeAudio,
  grade: gradeTask,
};
async function fenced(
  tx: ManagedTransaction,
  tutorId: string,
  examId: string,
  claim: string,
) {
  const node = await ownedExam(tx, tutorId, examId, true);
  const lease = Date.parse(node.processingLeaseUntil || "");
  if (
    node.status !== "processing" ||
    node.processingId !== claim ||
    !Number.isFinite(lease) ||
    lease <= Date.now()
  )
    throw new ApplicationError(409, "Grading lease was superseded.");
  await tx.run("MATCH(e:Exam {id:$examId}) SET e.processingLeaseUntil=$until", {
    examId,
    until: new Date(Date.now() + LEASE_MS).toISOString(),
  });
}

// One bounded attempt per tick. Leases fence late provider responses; checkpoints survive restarts.
export async function processSpeakingJob(
  api: SpeakingProviders = providers,
): Promise<boolean> {
  await ensureApplicationSchema();
  const s = getDriver().session();
  const claim = randomUUID();
  let job: { tutorId: string; examId: string; exam: SpeakingExam } | undefined;
  try {
    const now = new Date().toISOString();
    const candidates = await s.run(
      `MATCH(u:User)-[:TAKES]->(e:Exam {type:'speaking'})
      WHERE (e.status='queued' AND e.nextRunAt <= $now) OR
        (e.status='processing' AND (e.processingLeaseUntil IS NULL OR e.processingLeaseUntil <= $now)) OR
        (e.status='active' AND e.expiresAt <= $now)
      RETURN u.id AS tutorId,e.id AS examId ORDER BY e.createdAt LIMIT 10`,
      { now },
    );
    for (const row of candidates.records) {
      const tutorId = row.get("tutorId"),
        examId = row.get("examId");
      job = await s.executeWrite(async (tx) => {
        const node = await ownedExam(tx, tutorId, examId, true);
        if (!["queued", "processing", "active"].includes(node.status)) return;
        if (
          node.status === "active" &&
          Date.parse(node.expiresAt || "") > Date.now()
        )
          return;
        if (
          node.status === "processing" &&
          Date.parse(node.processingLeaseUntil || "") > Date.now()
        )
          return;
        if (
          node.status === "queued" &&
          Date.parse(node.nextRunAt || "") > Date.now()
        )
          return;
        const saved = (
          await tx.run(
            "MATCH(:Exam {id:$examId})-[:HAS_RECORDING]->(r:SpeakingRecording) RETURN r.id AS id",
            { examId },
          )
        ).records;
        // Legacy synchronous jobs have no recoverable audio. Do not silently grade them as failures.
        if (
          (node.status === "processing" &&
            !node.processingLeaseUntil &&
            !saved.length) ||
          (node.gradingRuns ?? 0) >= MAX_RUNS
        ) {
          await tx.run(
            "MATCH(e:Exam {id:$examId}) SET e.status='grading_failed',e.processingId=null,e.manualRetries=CASE WHEN $hasAudio THEN coalesce(e.manualRetries,0) ELSE 1 END",
            { examId, hasAudio: saved.length > 0 },
          );
          return;
        }
        await tx.run(
          `MATCH(e:Exam {id:$examId}) SET e.status='processing',e.processingId=$claim,
          e.processingLeaseUntil=$until,e.gradingRuns=coalesce(e.gradingRuns,0)+1`,
          {
            examId,
            claim,
            until: new Date(Date.now() + LEASE_MS).toISOString(),
          },
        );
        return {
          tutorId,
          examId,
          exam: JSON.parse(node.content) as SpeakingExam,
        };
      });
      if (job) break;
    }
    if (!job) return false;
    const { tutorId, examId, exam } = job,
      taskScores: TaskScore[] = [],
      evidence: Record<string, unknown>[] = [];
    const applicant=(await s.run('MATCH (u:User {id:$tutorId}) RETURN u',{tutorId})).records[0]?.get('u').properties;
    if(!applicant)throw new Error('Assessment applicant unavailable');
    const privateIdentity={names:[applicant.firstName,applicant.lastName,applicant.givenName,applicant.familyName,applicant.name,applicant.displayName].filter(Boolean),
      emails:[applicant.email].filter(Boolean),addresses:[applicant.address].filter(v=>typeof v==='string'),identifiers:[tutorId,examId,applicant.phone,applicant.phoneNumber].filter(Boolean)};
    for (const task of exam.tasks) {
      await s.executeWrite((tx) => fenced(tx, tutorId, examId, claim));
      const id = `${examId}:${task.id}`,
        aad = context(tutorId, examId, task.id);
      const recording = (
        await s.run("MATCH(r:SpeakingRecording {id:$id}) RETURN r", { id })
      ).records[0]?.get("r").properties;
      if (!recording) {
        taskScores.push(await gradeTask(task, ""));
        continue;
      }
      const { audioUrl } = JSON.parse(
        openPrivateEvidence(recording.encryptedAudio, aad).toString(),
      );
      const audio = decodeSubmittedAudio(audioUrl);
      if (
        createHash("sha256").update(audio).digest("hex") !== recording.audioHash
      )
        throw new Error("Recording integrity check failed");
      let transcript: string;
      if (recording.encryptedTranscript)
        transcript = openPrivateEvidence(
          recording.encryptedTranscript,
          `${aad}:transcript`,
        ).toString();
      else {
        const mime = audioUrl.slice(5, audioUrl.indexOf(";"));
        transcript = await api.transcribe(audio, mime);
        if (typeof transcript !== "string" || transcript.length > 20000)
          throw new Error("Invalid transcription result");
        const encrypted = sealPrivateEvidence(
          Buffer.from(transcript),
          `${aad}:transcript`,
        );
        await s.executeWrite(async (tx) => {
          await fenced(tx, tutorId, examId, claim);
          await tx.run(
            "MATCH(r:SpeakingRecording {id:$id}) SET r.encryptedTranscript=$encrypted",
            { id, encrypted },
          );
        });
      }
      let grade: TaskScore;
      if (recording.encryptedGrade)
        grade = JSON.parse(
          openPrivateEvidence(
            recording.encryptedGrade,
            `${aad}:grade`,
          ).toString(),
        );
      else {
        grade = transcript.trim()
          ? await withAIPrivacy(privateIdentity,()=>api.grade(task, transcript))
          : await gradeTask(task, "");
        const encrypted = sealPrivateEvidence(
          Buffer.from(JSON.stringify(grade)),
          `${aad}:grade`,
        );
        await s.executeWrite(async (tx) => {
          await fenced(tx, tutorId, examId, claim);
          await tx.run(
            "MATCH(r:SpeakingRecording {id:$id}) SET r.encryptedGrade=$encrypted",
            { id, encrypted },
          );
        });
      }
      taskScores.push(grade);
      evidence.push({
        tutorId,
        examId,
        taskId: task.id,
        source: "server-transcription",
        audioHash: recording.audioHash,
        transcriptHash: digest(transcript),
        privateAudioRef: `recording:${id}`,
      });
    }
    const result = summarizeSpeaking(exam, tutorId, taskScores);
    if (evidence.length !== exam.tasks.length) {
      result.passed = false;
      result.overallFeedback =
        "Recording time expired before all required tasks were saved. This attempt is incomplete.";
    }
    await s.executeWrite(async (tx) => {
      await fenced(tx, tutorId, examId, claim);
      await tx.run(
        `MATCH(e:Exam {id:$examId}) SET e.status='completed',e.result=$result,e.completedAt=$at,
        e.screeningAudioEvidence=$evidence,e.processingId=null,e.processingLeaseUntil=null`,
        {
          examId,
          result: JSON.stringify(result),
          at: result.completedAt,
          evidence: JSON.stringify(evidence),
        },
      );
      if (result.passed)
        await tx.run(
          "MATCH(u:User {id:$tutorId}) SET u.speakingExamPassed=true,u.speakingExamScore=$score,u.speakingExamPassedAt=$at",
          { tutorId, score: result.overallScore, at: result.completedAt },
        );
    });
    if (result.passed)
      void tryIssueAndMaybeSubmitTutorCertificationProof(
        tutorId,
        "speaking_exam_passed",
      );
    return true;
  } catch (error) {
    if (job) {
      await s.executeWrite(async (tx) => {
        await lockApplicant(tx, job!.tutorId, true);
        await tx.run(
          `MATCH(e:Exam {id:$examId,status:'processing',processingId:$claim})
          SET e.status=CASE WHEN e.gradingRuns >= $maxRuns THEN 'grading_failed' ELSE 'queued' END,
          e.nextRunAt=$next,e.processingId=null,e.processingLeaseUntil=null`,
          {
            examId: job!.examId,
            claim,
            maxRuns: MAX_RUNS,
            next: new Date(Date.now() + 30000).toISOString(),
          },
        );
      });
      // Do not log audio, transcripts, prompts, provider bodies or candidate identifiers.
      console.warn("Oral assessment job deferred; saved checkpoints retained.");
      return true;
    }
    throw error;
  } finally {
    await s.close();
  }
}

export function startSpeakingWorker() {
  let stopped = false,
    timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try {
      await processSpeakingJob();
    } catch {
      console.warn("Oral assessment worker unavailable; will retry.");
    }
    if (!stopped) {
      timer = setTimeout(tick, 5000);
      timer.unref?.();
    }
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
