import { Elysia, t } from "elysia";
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
  gradeSpeakingExam,
  getSpeakingExamStatus,
  getActiveSpeakingExam,
  getSpeakingExamResult,
  transcribeAudio,
} from "../services/exam.services/speaking.service";
import { verifyAuthToken, refreshJwtCookie } from "../utils/jwt";

const Examination = new Elysia({ prefix: "/exam" })

  // ============================================================================
  // GENERATE WRITTEN EXAM
  // POST /exam/written/generate
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .post(
    "/written/generate",
    async ({ body, cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      // SECURITY: Use authenticated tutor ID, ignore any tutorId from body
      const tutorId = payload.userId;
      
      // Refresh cookie
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        // Check for existing active exam first
        const existingExam = await getActiveExam(tutorId, "written");
        if (existingExam) {
          return {
            success: true,
            message: "Returning existing exam",
            exam: getExamForClient(existingExam),
          };
        }

        // Generate new exam using AI and save to Memgraph
        const exam = await generateWrittenExam(tutorId);

        return {
          success: true,
          message: "Exam generated successfully",
          exam: getExamForClient(exam),
        };
      } catch (error) {
        console.error("❌ Error generating exam:", error);
        return {
          success: false,
          message: "Failed to generate exam",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  )

  // ============================================================================
  // SUBMIT EXAM ANSWERS
  // POST /exam/written/submit
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .post(
    "/written/submit",
    async ({ body, cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      const tutorId = payload.userId;
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        const { examId, answers } = body;

        // Grade the exam (fetches from Memgraph, no AI needed)
        const result = await gradeExam(examId, tutorId, answers);

        return {
          success: true,
          message: result.passed
            ? "Congratulations! You passed the exam."
            : "Thank you for completing the exam.",
          result,
        };
      } catch (error) {
        console.error("❌ Error submitting exam:", error);
        return {
          success: false,
          message: "Failed to submit exam",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: t.Object({
        examId: t.String(),
        answers: t.Array(t.Number()), // Array of selected answer indices (0-3)
      }),
    }
  )

  // ============================================================================
  // SAVE ANSWERS (for resume functionality)
  // POST /exam/written/save
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .post(
    "/written/save",
    async ({ body, cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      const tutorId = payload.userId;
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        const { examId, answers, currentQuestion } = body;

        const success = await saveExamAnswers(examId, tutorId, answers, currentQuestion);

        return {
          success,
          message: success ? "Answers saved" : "Failed to save answers",
        };
      } catch (error) {
        console.error("❌ Error saving answers:", error);
        return {
          success: false,
          message: "Failed to save answers",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: t.Object({
        examId: t.String(),
        answers: t.Array(t.Number()),
        currentQuestion: t.Number(),
      }),
    }
  )

  // ============================================================================
  // CHECK EXPIRED EXAM
  // POST /exam/written/check-expired
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .post(
    "/written/check-expired",
    async ({ cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      const tutorId = payload.userId;
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        const result = await checkAndAutoSubmitExpiredExam(tutorId, "written");

        if (result.expired) {
          return {
            success: true,
            expired: true,
            message: result.result?.passed
              ? "Your exam time expired. Based on your saved answers, you passed!"
              : "Your exam time expired. Based on your saved answers, you did not pass.",
            result: result.result,
            canRetake: result.canRetake,
          };
        }

        return {
          success: true,
          expired: false,
        };
      } catch (error) {
        console.error("❌ Error checking expired exam:", error);
        return {
          success: false,
          message: "Failed to check exam status",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  )

  // ============================================================================
  // GET EXAM STATUS
  // GET /exam/status
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .get(
    "/status",
    async ({ cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      const tutorId = payload.userId;
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        const status = await getExamStatus(tutorId, "written");
        return {
          success: true,
          status,
        };
      } catch (error) {
        console.error("❌ Error getting exam status:", error);
        return {
          success: false,
          message: "Failed to get exam status",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  )

  // ============================================================================
  // GET EXAM RESULT WITH DETAILS
  // GET /exam/result/:examId
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .get(
    "/result/:examId",
    async ({ params, cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      const tutorId = payload.userId;
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        const data = await getExamResultWithDetails(tutorId, params.examId);

        if (!data) {
          return {
            success: false,
            message: "Exam result not found",
          };
        }

        return {
          success: true,
          exam: data.exam,
          result: data.result,
        };
      } catch (error) {
        console.error("❌ Error getting exam result:", error);
        return {
          success: false,
          message: "Failed to get exam result",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  )

  // ============================================================================
  // GET ACTIVE EXAM (resume incomplete exam)
  // GET /exam/active
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .get(
    "/active",
    async ({ cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      const tutorId = payload.userId;
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        const exam = await getActiveExam(tutorId, "written");

        if (!exam) {
          return {
            success: false,
            message: "No active exam found",
          };
        }

        return {
          success: true,
          exam: getExamForClient(exam),
        };
      } catch (error) {
        console.error("❌ Error getting active exam:", error);
        return {
          success: false,
          message: "Failed to get active exam",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  )

  // ============================================================================
  // SPEAKING EXAM ROUTES
  // ============================================================================

  // ============================================================================
  // GENERATE SPEAKING EXAM
  // POST /exam/speaking/generate
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .post(
    "/speaking/generate",
    async ({ cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      const tutorId = payload.userId;
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        // Check for existing active exam first
        const existingExam = await getActiveSpeakingExam(tutorId);
        if (existingExam) {
          return {
            success: true,
            message: "Returning existing exam",
            exam: getSpeakingExamForClient(existingExam),
          };
        }

        // Generate new speaking exam
        const exam = await generateSpeakingExam(tutorId);

        return {
          success: true,
          message: "Speaking exam generated successfully",
          exam: getSpeakingExamForClient(exam),
        };
      } catch (error) {
        console.error("❌ Error generating speaking exam:", error);
        return {
          success: false,
          message: "Failed to generate speaking exam",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  )

  // ============================================================================
  // TRANSCRIBE AUDIO
  // POST /exam/speaking/transcribe
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .post(
    "/speaking/transcribe",
    async ({ body, cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        const { audioBase64 } = body;

        // Convert base64 to buffer
        const audioBuffer = Buffer.from(audioBase64, "base64");

        // Transcribe using Whisper
        const transcription = await transcribeAudio(audioBuffer);

        return {
          success: true,
          transcription,
        };
      } catch (error) {
        console.error("❌ Error transcribing audio:", error);
        return {
          success: false,
          message: "Failed to transcribe audio",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: t.Object({
        audioBase64: t.String(),
      }),
    }
  )

  // ============================================================================
  // SUBMIT SPEAKING EXAM
  // POST /exam/speaking/submit
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .post(
    "/speaking/submit",
    async ({ body, cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      const tutorId = payload.userId;
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        const { examId, recordings } = body;

        const result = await gradeSpeakingExam(examId, tutorId, recordings);

        return {
          success: true,
          message: result.passed
            ? "Congratulations! You passed the speaking exam."
            : "Thank you for completing the speaking exam.",
          result,
        };
      } catch (error) {
        console.error("❌ Error submitting speaking exam:", error);
        return {
          success: false,
          message: "Failed to submit speaking exam",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: t.Object({
        examId: t.String(),
        recordings: t.Array(
          t.Object({
            taskId: t.Number(),
            audioUrl: t.String(),
            duration: t.Number(),
            transcription: t.Optional(t.String()),
          })
        ),
      }),
    }
  )

  // ============================================================================
  // GET SPEAKING EXAM STATUS
  // GET /exam/speaking/status
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .get(
    "/speaking/status",
    async ({ cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      const tutorId = payload.userId;
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        const status = await getSpeakingExamStatus(tutorId);
        return {
          success: true,
          status,
        };
      } catch (error) {
        console.error("❌ Error getting speaking exam status:", error);
        return {
          success: false,
          message: "Failed to get speaking exam status",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  )

  // ============================================================================
  // GET SPEAKING EXAM RESULT
  // GET /exam/speaking/result/:examId
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .get(
    "/speaking/result/:examId",
    async ({ params, cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      const tutorId = payload.userId;
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        const data = await getSpeakingExamResult(tutorId, params.examId);

        if (!data) {
          return {
            success: false,
            message: "Speaking exam result not found",
          };
        }

        return {
          success: true,
          exam: data.exam,
          result: data.result,
        };
      } catch (error) {
        console.error("❌ Error getting speaking exam result:", error);
        return {
          success: false,
          message: "Failed to get speaking exam result",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  )

  // ============================================================================
  // GET ACTIVE SPEAKING EXAM
  // GET /exam/speaking/active
  // SECURITY: Requires tutor authentication
  // ============================================================================
  .get(
    "/speaking/active",
    async ({ cookie, set }) => {
      // SECURITY: Verify tutor authentication
      const raw = cookie.tutorAuth?.value;
      if (!raw) {
        set.status = 401;
        return { success: false, message: "Authentication required" };
      }
      
      const payload = await verifyAuthToken(String(raw));
      if (!payload) {
        set.status = 401;
        return { success: false, message: "Invalid or expired token" };
      }
      
      const tutorId = payload.userId;
      await refreshJwtCookie(cookie, payload, 'tutorAuth');

      try {
        const exam = await getActiveSpeakingExam(tutorId);

        if (!exam) {
          return {
            success: false,
            message: "No active speaking exam found",
          };
        }

        return {
          success: true,
          exam: getSpeakingExamForClient(exam),
        };
      } catch (error) {
        console.error("❌ Error getting active speaking exam:", error);
        return {
          success: false,
          message: "Failed to get active speaking exam",
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );

export default Examination;
