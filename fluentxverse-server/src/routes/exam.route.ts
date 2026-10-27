import { Elysia, t } from "elysia";
import { verifyAuthToken, refreshJwtCookie } from "../utils/jwt";
import { getDriver } from "../db/memgraph";
import { isAllowedTutorMutationOrigin } from "../config/cors";
import { tutorEmailVerified } from '../services/auth.services/tutorEmailPolicy';
import {
  ApplicationError,
  applicationFailure,
} from "../services/exam.services/applicationPolicy";
import {
  generateWrittenExam,
  gradeExam,
  getExamForClient,
  getExamStatus,
  getActiveExam,
  getExamResultWithDetails,
  saveExamAnswers,
  checkAndAutoSubmitExpiredExam,
} from "../services/exam.services/exam.service";
import {
  generateSpeakingExam,
  getSpeakingExamForClient,
  getSpeakingExamStatus,
  getActiveSpeakingExam,
  getSpeakingExamResult,
} from "../services/exam.services/speaking.service";
import {
  saveSpeakingRecording,
  submitSpeakingExam,
} from "../services/exam.services/speakingQueue";

const id = t.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-zA-Z0-9_-]+$",
});
const answers = t.Array(t.Integer({ minimum: -1, maximum: 3 }), {
  maxItems: 30,
});
const Examination = new Elysia({ prefix: "/exam" })
  .onError(({ error, code, set }) => {
    const failure =
      code === "VALIDATION"
        ? { status: 422, message: "Invalid assessment request." }
        : applicationFailure(error);
    set.status = failure.status;
    return { success: false, message: failure.message, error: failure.message };
  })
  .resolve(async ({ cookie, request, set }) => {
    set.headers["cache-control"] = "private, no-store";
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !isAllowedTutorMutationOrigin(request.headers.get("origin"))
    )
      throw new ApplicationError(403, "Tutor application origin required.");
    const raw = cookie.tutorAuth?.value,
      payload = raw ? await verifyAuthToken(String(raw)) : null;
    if (!payload || payload.role !== "tutor")
      throw new ApplicationError(401, "Tutor authentication required.");
    const session = getDriver().session();
    try {
      const user = (
        await session.run("MATCH(u:User {id:$id}) RETURN u", {
          id: payload.userId,
        })
      ).records[0]?.get("u").properties;
      if (!user || (user.role && user.role !== "tutor"))
        throw new ApplicationError(401, "Tutor account not found.");
      if (Date.parse(user.suspendedUntil || "") > Date.now())
        throw new ApplicationError(403, "This account is suspended.");
      if (!new URL(request.url).pathname.endsWith('/status') && !tutorEmailVerified(user))
        throw new ApplicationError(403, 'Confirm your email address before continuing your tutor assessment.');
    } finally {
      await session.close();
    }
    await refreshJwtCookie(cookie, payload, "tutorAuth");
    return { tutorId: payload.userId };
  })
  .post("/written/generate", async ({ tutorId }) => ({
    success: true,
    exam: getExamForClient(await generateWrittenExam(tutorId)),
  }))
  .post(
    "/written/submit",
    async ({ body, tutorId }) => ({
      success: true,
      result: await gradeExam(body.examId, tutorId, body.answers),
    }),
    {
      body: t.Object({ examId: id, answers }),
    },
  )
  .post(
    "/written/save",
    async ({ body, tutorId }) => ({
      success: await saveExamAnswers(
        body.examId,
        tutorId,
        body.answers,
        body.currentQuestion,
      ),
    }),
    {
      body: t.Object({
        examId: id,
        answers,
        currentQuestion: t.Integer({ minimum: 0, maximum: 29 }),
      }),
    },
  )
  .post("/written/check-expired", async ({ tutorId }) => ({
    success: true,
    ...(await checkAndAutoSubmitExpiredExam(tutorId)),
  }))
  .get("/status", async ({ tutorId }) => ({
    success: true,
    status: await getExamStatus(tutorId),
  }))
  .get("/active", async ({ tutorId }) => {
    const exam = await getActiveExam(tutorId);
    return { success: !!exam, exam: exam ? getExamForClient(exam) : undefined };
  })
  .get(
    "/result/:examId",
    async ({ tutorId, params }) => {
      const data = await getExamResultWithDetails(tutorId, params.examId);
      if (!data) throw new ApplicationError(404, "Written result not found.");
      return { success: true, ...data };
    },
    { params: t.Object({ examId: id }) },
  )
  .post("/speaking/generate", async ({ tutorId }) => ({
    success: true,
    exam: getSpeakingExamForClient(await generateSpeakingExam(tutorId)),
  }))
  .post(
    "/speaking/recording",
    async ({ tutorId, body }) => ({
      success: true,
      ...(await saveSpeakingRecording(tutorId, body.examId, body.recording)),
    }),
    {
      body: t.Object({
        examId: id,
        recording: t.Object({
          taskId: t.Integer({ minimum: 1, maximum: 10 }),
          audioUrl: t.String({
            minLength: 80,
            maxLength: 8 * 1024 * 1024 + 100,
          }),
          duration: t.Number({ minimum: 0.5, maximum: 125 }),
        }),
      }),
    },
  )
  .post(
    "/speaking/submit",
    async ({ tutorId, body, set }) => {
      const job = await submitSpeakingExam(tutorId, body.examId);
      set.status = job.state === "completed" ? 200 : 202;
      return { success: true, ...job };
    },
    { body: t.Object({ examId: id }) },
  )
  .post(
    "/speaking/retry",
    async ({ tutorId, body, set }) => {
      const job = await submitSpeakingExam(tutorId, body.examId, true);
      set.status = 202;
      return { success: true, ...job };
    },
    { body: t.Object({ examId: id }) },
  )
  // No free-floating transcription endpoint: every paid assessment call is bound to saved attempt audio.
  .post("/speaking/transcribe", ({ set }) => {
    set.status = 410;
    return {
      success: false,
      message: "Recordings are transcribed after assessment submission.",
    };
  })
  .get("/speaking/status", async ({ tutorId }) => ({
    success: true,
    status: await getSpeakingExamStatus(tutorId),
  }))
  .get("/speaking/active", async ({ tutorId }) => {
    const exam = await getActiveSpeakingExam(tutorId);
    return {
      success: !!exam,
      exam: exam ? getSpeakingExamForClient(exam) : undefined,
    };
  })
  .get(
    "/speaking/result/:examId",
    async ({ tutorId, params }) => {
      const data = await getSpeakingExamResult(tutorId, params.examId);
      if (!data) throw new ApplicationError(404, "Oral result not found.");
      return {
        success: true,
        exam: getSpeakingExamForClient(data.exam),
        result: data.result,
      };
    },
    { params: t.Object({ examId: id }) },
  );

export default Examination;
