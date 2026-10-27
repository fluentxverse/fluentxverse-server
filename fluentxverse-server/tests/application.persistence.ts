// Run explicitly against the disposable QA container, never the production database.
import { afterAll, beforeAll, describe, test, expect, mock } from "bun:test";
import { randomUUID } from "node:crypto";
import { speakingFixture, writtenFixture } from "./application.fixtures";
process.env.SCREENING_ENABLED = "false";
process.env.SCREENING_EVIDENCE_KEY_HEX = "a1".repeat(32);
mock.module("../src/services/agentFactory", () => ({
  createAgent: (config: { name: string }) => ({
    generate: async (_prompt: unknown, options: any) => ({
      object: options.structuredOutput.schema.parse(
        config.name.includes("Written") ? writtenFixture() : speakingFixture(),
      ),
    }),
  }),
}));
mock.module(
  "../src/services/proof.services/tutorCertificationWorkflow.service",
  () => ({ tryIssueAndMaybeSubmitTutorCertificationProof: async () => null }),
);
const { initDriver, closeDriver, getDriver } = await import(
  "../src/db/memgraph"
);
const { reserveGeneration } = await import(
  "../src/services/exam.services/applicationPolicy"
);
const {
  generateWrittenExam,
  gradeExam,
  saveExamAnswers,
  getExamStatus,
  getExamForClient,
} = await import("../src/services/exam.services/exam.service");
const {
  generateSpeakingExam,
  getActiveSpeakingExam,
  parseTaskGrade,
  getSpeakingExamResult,
} = await import("../src/services/exam.services/speaking.service");
const { saveSpeakingRecording, submitSpeakingExam, processSpeakingJob } =
  await import("../src/services/exam.services/speakingQueue");
const { loadPrivateAudio } = await import("../src/services/screening/storage");
const { InterviewService } = await import(
  "../src/services/interview.services/interview.service"
);
const { assertTutorApplicationApproved } = await import(
  "../src/services/schedule.services/schedulingGuards"
);
const { signAuthToken } = await import("../src/utils/jwt");
const { default: Examination } = await import("../src/routes/exam.route");
const interview = new InterviewService();
const uri = process.env.APPLICATION_TEST_URI;
if (uri !== "bolt://127.0.0.1:17706")
  throw new Error(
    "Set APPLICATION_TEST_URI=bolt://127.0.0.1:17706 for the dedicated empty QA container",
  );
async function query(cypher: string, params: Record<string, any> = {}) {
  const s = getDriver().session();
  try {
    return await s.run(cypher, params);
  } finally {
    await s.close();
  }
}
async function applicant(flags: Record<string, any> = {}) {
  const id = `qa-${randomUUID()}`;
  await query("CREATE(u:User {id:$id,email:'applicant@example.test',verifiedEmail:true,verifiedEmailAddress:'applicant@example.test'}) SET u += $flags", { id, flags });
  return id;
}
const audioUrl = `data:audio/webm;base64,${Buffer.alloc(128, 7).toString("base64")}`;
const completeRecordings = async (id: string, examId: string) => {
  for (let taskId = 1; taskId <= 10; taskId++)
    await saveSpeakingRecording(id, examId, { taskId, audioUrl, duration: 5 });
};
const provider = {
  transcribe: async () => "A relevant teaching response.",
  grade: async (task: any, transcript: string) =>
    parseTaskGrade(task, transcript, {
      scores: { vocabulary: 5, grammar: 5, coherence: 5, taskCompletion: 5 },
      feedback: "Relevant and accurate.",
    }),
};
beforeAll(async () => {
  await initDriver(uri!, "", "");
  if (
    (await query("MATCH(n) RETURN count(n) AS count")).records[0]!.get(
      "count",
    ).toNumber() !== 0
  )
    throw new Error("QA database must be empty");
});
afterAll(async () => {
  await closeDriver();
});

describe("tutor application persistence and adversarial paths", () => {
  test("written generation returns 30 questions, never exposes answers and reserves a single attempt", async () => {
    const id = await applicant();
    const exam = await generateWrittenExam(id);
    expect(exam.questions).toHaveLength(30);
    expect(exam.startedAt).toBeTruthy();
    expect(JSON.stringify(getExamForClient(exam))).not.toContain(
      "correctAnswer",
    );
    expect((await generateWrittenExam(id)).examId).toBe(exam.examId);
    const second = await applicant();
    const races = await Promise.allSettled([
      reserveGeneration(second, "written"),
      reserveGeneration(second, "written"),
    ]);
    expect(races.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await query(
          "MATCH(:User {id:$id})-[:TAKES]->(e) RETURN count(e) AS count",
          { id: second },
        )
      ).records[0]!.get("count").toNumber(),
    ).toBe(1);
  });
  test("blocks oral generation and interviews before prerequisite passes", async () => {
    const id = await applicant();
    await expect(generateSpeakingExam(id)).rejects.toThrow("written");
    await expect(interview.bookSlot("absent", id)).rejects.toThrow(
      "written and speaking",
    );
  });
  test("duplicate written submissions return the same committed result", async () => {
    const id = await applicant(),
      exam = await generateWrittenExam(id);
    const results = await Promise.all([
      gradeExam(exam.examId, id, Array(30).fill(0)),
      gradeExam(exam.examId, id, Array(30).fill(0)),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect((await getExamStatus(id)).passed).toBe(true);
  });
  test("late answers cannot replace saved answers; late autosave is rejected", async () => {
    const id = await applicant(),
      exam = await generateWrittenExam(id);
    await saveExamAnswers(exam.examId, id, Array(30).fill(1), 5);
    await query(
      "MATCH(e:Exam {id:$id}) SET e.startedAt='2020-01-01T00:00:00Z'",
      { id: exam.examId },
    );
    await expect(
      saveExamAnswers(exam.examId, id, Array(30).fill(0), 0),
    ).rejects.toThrow("expired");
    const result = await gradeExam(exam.examId, id, Array(30).fill(0));
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
  });
  test("result and pass flag commit atomically; replay repairs legacy partial flags", async () => {
    const id = await applicant(),
      exam = await generateWrittenExam(id);
    const driver = getDriver(),
      session = driver.session.bind(driver);
    driver.session = ((...args: any[]) => {
      const s = session(...args);
      const execute = s.executeWrite.bind(s);
      s.executeWrite = ((work: any) =>
        execute(async (tx) =>
          work(
            new Proxy(tx, {
              get(target, key) {
                if (key === "run")
                  return (cypher: string, params: any) => {
                    if (cypher.includes("SET u.writtenExamPassed=true"))
                      throw new Error("Injected DB fault before flag update");
                    return target.run(cypher, params);
                  };
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          ),
        )) as any;
      return s;
    }) as any;
    try {
      await expect(
        gradeExam(exam.examId, id, Array(30).fill(0)),
      ).rejects.toThrow("Injected DB fault");
    } finally {
      driver.session = session as any;
    }
    expect(
      (
        await query(
          "MATCH(e:Exam {id:$id}) RETURN e.status AS status,e.result AS result",
          { id: exam.examId },
        )
      ).records[0]!.get("status"),
    ).toBe("active");
    const result = await gradeExam(exam.examId, id, Array(30).fill(0));
    expect(result.passed).toBe(true);
    await query("MATCH(u:User {id:$id}) REMOVE u.writtenExamPassed", { id });
    expect((await gradeExam(exam.examId, id, [])).percentage).toBe(100);
    expect((await getExamStatus(id)).passed).toBe(true);
    expect(
      (
        await query(
          "MATCH(u:User {id:$id}) RETURN u.writtenExamPassed AS passed",
          { id },
        )
      ).records[0]!.get("passed"),
    ).toBe(true);
  });
  test("only two failed written attempts in rolling 30 days", async () => {
    const id = await applicant();
    for (let i = 0; i < 2; i++) {
      await query(
        "MATCH(u:User {id:$id}) SET u.writtenGenerationAt='2020-01-01T00:00:00Z'",
        { id },
      );
      const exam = await generateWrittenExam(id);
      await gradeExam(exam.examId, id, []);
    }
    await expect(generateWrittenExam(id)).rejects.toThrow("both attempts");
    expect((await getExamStatus(id)).attemptsThisMonth).toBe(2);
  });
  test("malformed legacy written attempts are retired without consuming an attempt", async () => {
    const id = await applicant(),
      legacy = writtenFixture("legacy-malformed");
    legacy.questions.pop();
    await query(
      "MATCH(u:User {id:$id}) CREATE(e:Exam {id:'legacy-malformed',type:'written',status:'active',createdAt:$now,startedAt:$now,content:$content}) CREATE(u)-[:TAKES]->(e)",
      { id, now: new Date().toISOString(), content: JSON.stringify(legacy) },
    );
    const replacement = await generateWrittenExam(id);
    expect(replacement.questions).toHaveLength(30);
    expect(replacement.examId).not.toBe(legacy.examId);
    expect((await getExamStatus(id)).attemptsThisMonth).toBe(0);
    expect(
      (
        await query(
          "MATCH(e:Exam {id:'legacy-malformed'}) RETURN e.status AS status",
        )
      ).records[0]!.get("status"),
    ).toBe("invalidated");
  });
  test("audio checkpoints are encrypted, immutable, resumable, owned and idempotent", async () => {
    const id = await applicant({ writtenExamPassed: true }),
      exam = await generateSpeakingExam(id);
    const recording = { taskId: 1, audioUrl, duration: 5 };
    await saveSpeakingRecording(id, exam.examId, recording);
    await saveSpeakingRecording(id, exam.examId, recording);
    expect((await getActiveSpeakingExam(id))!.savedTaskIds).toEqual([1]);
    const r = (
      await query("MATCH(r:SpeakingRecording {id:$id}) RETURN r", {
        id: `${exam.examId}:1`,
      })
    ).records[0]!.get("r").properties;
    expect(JSON.stringify(r)).not.toContain(audioUrl);
    expect(await loadPrivateAudio(`recording:${exam.examId}:1`)).toEqual(
      Buffer.alloc(128, 7),
    );
    await expect(
      saveSpeakingRecording(id, exam.examId, {
        ...recording,
        audioUrl: `data:audio/webm;base64,${Buffer.alloc(128, 8).toString("base64")}`,
      }),
    ).rejects.toThrow("already has");
    await expect(
      saveSpeakingRecording(await applicant(), exam.examId, recording),
    ).rejects.toThrow("not found");
    await expect(submitSpeakingExam(id, exam.examId)).rejects.toThrow(
      "every task",
    );
    const key = process.env.SCREENING_EVIDENCE_KEY_HEX;
    delete process.env.SCREENING_EVIDENCE_KEY_HEX;
    try {
      await expect(
        saveSpeakingRecording(id, exam.examId, { ...recording, taskId: 2 }),
      ).rejects.toThrow("not configured");
    } finally {
      process.env.SCREENING_EVIDENCE_KEY_HEX = key;
    }
  });
  test("grading resumes encrypted checkpoints after provider failure and expired worker lease", async () => {
    const id = await applicant({ writtenExamPassed: true }),
      exam = await generateSpeakingExam(id);
    await completeRecordings(id, exam.examId);
    expect((await submitSpeakingExam(id, exam.examId)).state).toBe("queued");
    expect((await submitSpeakingExam(id, exam.examId)).state).toBe("queued");
    let transcriptions = 0,
      grades = 0;
    const flaky = {
      transcribe: async () => {
        transcriptions++;
        return provider.transcribe();
      },
      grade: async (task: any, transcript: string) => {
        grades++;
        if (task.id === 2) throw Error("Provider down");
        return provider.grade(task, transcript);
      },
    };
    await processSpeakingJob(flaky);
    expect(transcriptions).toBe(2);
    expect(grades).toBe(2);
    await query(
      "MATCH(e:Exam {id:$id}) SET e.status='processing',e.processingId='dead-worker',e.processingLeaseUntil='2020-01-01T00:00:00Z'",
      { id: exam.examId },
    );
    const resumed = {
      transcribe: async () => {
        transcriptions++;
        return provider.transcribe();
      },
      grade: async (task: any, transcript: string) => {
        grades++;
        return provider.grade(task, transcript);
      },
    };
    await processSpeakingJob(resumed);
    expect(transcriptions).toBe(10);
    expect(grades).toBe(11);
    const result = (await getSpeakingExamResult(id, exam.examId))!.result;
    expect(result.passed).toBe(true);
    expect(result.audioReviewRequired).toBe(true);
    expect(result.sectionAverages.pronunciation).toBeNull();
    expect((await getExamStatus(id, "speaking")).passed).toBe(true);
  });
  test("orphaned legacy processing attempts fail explicitly instead of spinning forever", async () => {
    const id = await applicant({ writtenExamPassed: true }),
      exam = await generateSpeakingExam(id);
    await query(
      "MATCH(e:Exam {id:$id}) SET e.status='processing',e.processingLeaseUntil=null",
      { id: exam.examId },
    );
    await processSpeakingJob(provider);
    expect((await getExamStatus(id, "speaking")).gradingFailed).toBe(true);
    await expect(submitSpeakingExam(id, exam.examId, true)).rejects.toThrow(
      "support review",
    );
  });
  test("provider failures have bounded automatic and manual retries without charging failed exam attempts", async () => {
    const id = await applicant({ writtenExamPassed: true }),
      exam = await generateSpeakingExam(id);
    await completeRecordings(id, exam.examId);
    await submitSpeakingExam(id, exam.examId);
    let calls = 0;
    const unavailable = {
      ...provider,
      transcribe: async () => {
        calls++;
        throw Error("Provider unavailable");
      },
    };
    for (let i = 0; i < 3; i++) {
      await query(
        "MATCH(e:Exam {id:$id}) SET e.nextRunAt='2020-01-01T00:00:00Z'",
        { id: exam.examId },
      );
      await processSpeakingJob(unavailable);
    }
    expect(calls).toBe(3);
    let status = await getExamStatus(id, "speaking");
    expect(status.gradingFailed).toBe(true);
    expect(status.attemptsThisMonth).toBe(0);
    expect(status.canRetryGrading).toBe(true);
    await processSpeakingJob(unavailable);
    expect(calls).toBe(3);
    await submitSpeakingExam(id, exam.examId, true);
    for (let i = 0; i < 3; i++) {
      await query(
        "MATCH(e:Exam {id:$id}) SET e.nextRunAt='2020-01-01T00:00:00Z'",
        { id: exam.examId },
      );
      await processSpeakingJob(unavailable);
    }
    status = await getExamStatus(id, "speaking");
    expect(status.canRetryGrading).toBe(false);
    await expect(submitSpeakingExam(id, exam.examId, true)).rejects.toThrow(
      "support review",
    );
  });
  test("late workers cannot commit after losing their lease", async () => {
    const id = await applicant({ writtenExamPassed: true }),
      exam = await generateSpeakingExam(id);
    await completeRecordings(id, exam.examId);
    await submitSpeakingExam(id, exam.examId);
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = processSpeakingJob({
      ...provider,
      transcribe: async () => {
        started();
        await waiting;
        return "Late response";
      },
    });
    await entered;
    await query(
      "MATCH(e:Exam {id:$id}) SET e.processingLeaseUntil='2020-01-01T00:00:00Z'",
      { id: exam.examId },
    );
    await processSpeakingJob(provider);
    const completed = (await getSpeakingExamResult(id, exam.examId))!.result;
    release();
    await slow;
    expect((await getSpeakingExamResult(id, exam.examId))!.result).toEqual(
      completed,
    );
    expect(JSON.stringify(completed)).not.toContain("Late response");
  });
  test("oral completion and user pass flags roll back together on a database fault", async () => {
    const id = await applicant({ writtenExamPassed: true }),
      exam = await generateSpeakingExam(id);
    await completeRecordings(id, exam.examId);
    await submitSpeakingExam(id, exam.examId);
    const driver = getDriver(),
      session = driver.session.bind(driver);
    driver.session = ((...args: any[]) => {
      const s = session(...args),
        execute = s.executeWrite.bind(s);
      s.executeWrite = ((work: any) =>
        execute(async (tx) =>
          work(
            new Proxy(tx, {
              get(target, key) {
                if (key === "run")
                  return (cypher: string, params: any) => {
                    if (cypher.includes("SET u.speakingExamPassed=true"))
                      throw Error("Injected completion fault");
                    return target.run(cypher, params);
                  };
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          ),
        )) as any;
      return s;
    }) as any;
    try {
      await processSpeakingJob(provider);
    } finally {
      driver.session = session as any;
    }
    expect(await getSpeakingExamResult(id, exam.examId)).toBeNull();
    expect(
      (
        await query(
          "MATCH(u:User {id:$id}) RETURN u.speakingExamPassed AS passed",
          { id },
        )
      ).records[0]!.get("passed"),
    ).toBeNull();
    await query(
      "MATCH(e:Exam {id:$id}) SET e.nextRunAt='2020-01-01T00:00:00Z'",
      { id: exam.examId },
    );
    await processSpeakingJob(provider);
    expect((await getSpeakingExamResult(id, exam.examId))!.result.passed).toBe(
      true,
    );
  });
  test("booking races never give one applicant two interviews or two applicants one interview", async () => {
    const id = await applicant({
      writtenExamPassed: true,
      speakingExamPassed: true,
    });
    const slots = await interview.createSlots([
      { date: "2030-01-07", time: "1:00 PM" },
      { date: "2030-01-07", time: "2:00 PM" },
    ]);
    const results = await Promise.allSettled(
      slots.map((slot) => interview.bookSlot(slot.id, id)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const booked = (
      results.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<any>
    ).value;
    await interview.cancelBooking(booked.id, id);
    const other = await applicant({
      writtenExamPassed: true,
      speakingExamPassed: true,
    });
    const competing = await Promise.allSettled([
      interview.bookSlot(booked.id, id),
      interview.bookSlot(booked.id, other),
    ]);
    expect(competing.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const creates = await Promise.allSettled([
      interview.createSlots([{ date: "2030-01-08", time: "1:00 PM" }]),
      interview.createSlots([{ date: "2030-01-08", time: "1:00 PM" }]),
    ]);
    expect(
      creates.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
    ).toHaveLength(1);
    expect(
      (
        await query(
          "MATCH(s:InterviewSlot {date:'2030-01-08',time:'1:00 PM'}) RETURN count(s) AS count",
        )
      ).records[0]!.get("count").toNumber(),
    ).toBe(1);
  });
  test("past interview slots and invalid dates cannot be booked or published", async () => {
    const id = await applicant({
      writtenExamPassed: true,
      speakingExamPassed: true,
    });
    await expect(
      interview.createSlots([{ date: "2020-01-01", time: "1:00 PM" }]),
    ).rejects.toThrow("future");
    await query(
      "CREATE(:InterviewSlot {id:'past-slot',date:'2020-01-01',time:'1:00 PM',status:'open'})",
    );
    await expect(interview.bookSlot("past-slot", id)).rejects.toThrow(
      "no longer available",
    );
  });
  test("HTTP derives identity from tutor cookie and rejects wrong roles, origins and unowned results", async () => {
    const id = await applicant();
    const token = await signAuthToken({
      userId: id,
      email: "qa@example.invalid",
      role: "tutor",
    });
    const request = (
      path: string,
      method = "GET",
      body?: any,
      origin = "https://tutor.fluentxverse.com",
      auth = token,
    ) =>
      Examination.handle(
        new Request(`http://localhost/exam${path}`, {
          method,
          headers: {
            cookie: `tutorAuth=${auth}`,
            origin,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
    expect((await request("/active")).status).toBe(200);
    expect((await request("/speaking/active")).status).toBe(200);
    expect((await request("/speaking/generate", "POST")).status).toBe(409);
    expect(
      (await request("/written/generate", "POST", {}, "https://evil.example"))
        .status,
    ).toBe(403);
    const wrong = await signAuthToken({
      userId: id,
      email: "qa@example.invalid",
      role: "student",
    });
    expect(
      (
        await request(
          "/status",
          "GET",
          undefined,
          "https://tutor.fluentxverse.com",
          wrong,
        )
      ).status,
    ).toBe(401);
    const exam = await generateWrittenExam(id);
    expect(
      (
        await request("/written/submit", "POST", {
          examId: exam.examId,
          answers: [9],
        })
      ).status,
    ).toBe(422);
    const another = await applicant();
    const otherExam = await generateWrittenExam(another);
    expect(
      (
        await request("/written/submit", "POST", {
          examId: otherExam.examId,
          answers: [],
        })
      ).status,
    ).toBe(404);
    expect((await request(`/result/${otherExam.examId}`)).status).toBe(404);
  });
  test("lesson checkout requires every application approval, retaining only the existing explicit QA waiver", async () => {
    const id = await applicant({
      writtenExamPassed: true,
      speakingExamPassed: true,
      profileStatus: "approved",
    });
    const session = getDriver().session();
    try {
      await expect(
        session.executeWrite((tx) => assertTutorApplicationApproved(tx, id)),
      ).rejects.toThrow("interview");
      await query("MATCH(u:User {id:$id}) SET u.interviewPassed=true", { id });
      await expect(
        session.executeWrite((tx) => assertTutorApplicationApproved(tx, id)),
      ).resolves.toBeUndefined();
      await query("MATCH(u:User {id:$id}) SET u.profileStatus='pending'", {
        id,
      });
      await expect(
        session.executeWrite((tx) => assertTutorApplicationApproved(tx, id)),
      ).rejects.toThrow("profile approval");
      const qa = await applicant({ email: "paulanthonyarriola@gmail.com" });
      await expect(
        session.executeWrite((tx) => assertTutorApplicationApproved(tx, qa)),
      ).resolves.toBeUndefined();
    } finally {
      await session.close();
    }
  });
  test("HTTP oral submission returns 202 and replay polls the owned completed result", async () => {
    const id = await applicant({ writtenExamPassed: true }),
      exam = await generateSpeakingExam(id);
    await completeRecordings(id, exam.examId);
    const token = await signAuthToken({
      userId: id,
      email: "qa@example.invalid",
      role: "tutor",
    });
    const response = await Examination.handle(
      new Request("http://localhost/exam/speaking/submit", {
        method: "POST",
        headers: {
          cookie: `tutorAuth=${token}`,
          origin: "https://tutor.fluentxverse.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ examId: exam.examId }),
      }),
    );
    expect(response.status).toBe(202);
    const queued = (await response.json()) as { state: string };
    expect(queued.state).toBe("queued");
    await processSpeakingJob(provider);
    const completed = await Examination.handle(
      new Request(`http://localhost/exam/speaking/result/${exam.examId}`, {
        headers: { cookie: `tutorAuth=${token}` },
      }),
    );
    expect(completed.status).toBe(200);
    expect(completed.headers.get("cache-control")).toBe("private, no-store");
    const data = (await completed.json()) as {
      result: {
        passed: boolean;
        sectionAverages: { pronunciation: number | null };
      };
      exam: unknown;
    };
    expect(data.result.passed).toBe(true);
    expect(JSON.stringify(data.exam)).not.toContain("imageDescription");
    expect(data.result.sectionAverages.pronunciation).toBeNull();
  });
});
