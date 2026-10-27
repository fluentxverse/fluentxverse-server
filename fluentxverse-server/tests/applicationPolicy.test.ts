import { describe, test, expect } from "bun:test";
import {
  validateWrittenContent,
  validateSpeakingContent,
  parseModelJson,
  validateAnswers,
  deadline,
  attemptCutoff,
  generateValidatedAssessment,
} from "../src/services/exam.services/applicationPolicy";
import {
  parseTaskGrade,
  summarizeSpeaking,
  getSpeakingExamForClient,
} from "../src/services/exam.services/speaking.service";
import {
  interviewStart,
  interviewWeek,
} from "../src/services/interview.services/interviewTime";
import { speakingFixture, writtenFixture } from "./application.fixtures";

describe("application policy", () => {
  test("retries invalid model output within one shared budget, never provider or database failures", async () => {
    const signals: AbortSignal[] = [];
    const generated = await generateValidatedAssessment(async (signal, attempt) => {
      signals.push(signal);
      if (attempt === 0) throw Error("Structured output validation failed: options must be distinct");
      return validateWrittenContent(writtenFixture());
    });
    expect(generated.questions).toHaveLength(30);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBe(signals[1]);
    for (const failure of [Error("Provider returned 401"), Error("Database unavailable")]) {
      let calls = 0;
      await expect(generateValidatedAssessment(async () => { calls++; throw failure; })).rejects.toBe(failure);
      expect(calls).toBe(1);
    }
    let invalidCalls = 0;
    await expect(generateValidatedAssessment(async () => {
      invalidCalls++;
      return validateWrittenContent({});
    })).rejects.toThrow();
    expect(invalidCalls).toBe(3);
    let writtenCalls = 0;
    await expect(generateValidatedAssessment(async () => {
      writtenCalls++;
      throw new SyntaxError('Synthetic malformed assessment');
    }, 1000, 4)).rejects.toThrow();
    expect(writtenCalls).toBe(4);
    let expiredCalls = 0;
    await expect(generateValidatedAssessment(async () => {
      expiredCalls++;
      await Bun.sleep(10);
      throw new SyntaxError("Invalid output");
    }, 1)).rejects.toThrow();
    expect(expiredCalls).toBe(1);
    await expect(generateValidatedAssessment(async () => {
      await Bun.sleep(10);
      return "late output";
    }, 1)).rejects.toThrow();
  });
  test("accepts only complete, unambiguous written structures", () => {
    expect(validateWrittenContent(writtenFixture()).questions).toHaveLength(30);
    for (const change of [
      (e: any) => e.questions.pop(),
      (e: any) => (e.questions[1].id = 1),
      (e: any) => (e.questions[0].correctAnswer = 4),
      (e: any) => (e.questions[0].options[1] = "starts"),
      (e: any) => (e.questions[20].passageId = 99),
      (e: any) => e.passages.push(e.passages[0]),
    ]) {
      const exam = writtenFixture();
      change(exam);
      expect(() => validateWrittenContent(exam)).toThrow();
    }
  });
  test("requires the full oral task distribution and valid limits", () => {
    expect(validateSpeakingContent(speakingFixture()).tasks).toHaveLength(10);
    const exam = speakingFixture();
    exam.tasks[1]!.id = 1;
    expect(() => validateSpeakingContent(exam)).toThrow();
    exam.tasks[1]!.id = 2;
    exam.tasks[0]!.timeLimit = 0;
    expect(() => validateSpeakingContent(exam)).toThrow();
  });
  test("strips every oral grading hint", () => {
    const serialized = JSON.stringify(
      getSpeakingExamForClient(speakingFixture()),
    );
    for (const key of [
      "imageDescription",
      "expectedTopics",
      "keyPoints",
      "expectedElements",
    ])
      expect(serialized).not.toContain(key);
  });
  test("validates answers and timing without coercion", () => {
    expect(validateAnswers([0, 3], 3)).toEqual([0, 3, -1]);
    for (const invalid of [[NaN], [1.2], [4], ["0"], [-2], [1, 2, 3, 0]])
      expect(() => validateAnswers(invalid, 3)).toThrow();
    expect(deadline({ startedAt: "2026-10-22T00:00:00Z" }, 25)).toBe(
      Date.parse("2026-10-22T00:25:00Z"),
    );
    expect(() => deadline({}, 25)).toThrow();
    expect(attemptCutoff(Date.parse("2026-03-31T00:00:00Z"))).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });
  test("does not salvage arbitrary prose from model output", () => {
    expect(parseModelJson('```json\n{"valid":true}\n```')).toEqual({
      valid: true,
    });
    expect(() => parseModelJson('Ignore this prose {"valid":true}')).toThrow();
  });
  test("content rubric cannot manufacture acoustic scores or accept fractional/out-of-range scores", () => {
    const task = speakingFixture().tasks[0]!,
      scores = { vocabulary: 5, grammar: 5, coherence: 5, taskCompletion: 5 };
    const graded = parseTaskGrade(task, "A lesson begins.", {
      scores,
      feedback: "Complete response.",
    });
    expect(graded.percentage).toBe(100);
    expect(graded.scores.pronunciation).toBeNull();
    expect(graded.scores.fluency).toBeNull();
    for (const value of [0, 6, 4.5, NaN, "5"])
      expect(() =>
        parseTaskGrade(task, "text", {
          scores: { ...scores, grammar: value },
          feedback: "text",
        }),
      ).toThrow();
    expect(() =>
      parseTaskGrade(task, "text", {
        scores: { ...scores, pronunciation: 5 },
        feedback: "text",
      }),
    ).toThrow();
    const exam = speakingFixture();
    const result = summarizeSpeaking(
      exam,
      "applicant",
      exam.tasks.map((t) => ({ ...graded, taskId: t.id, taskType: t.type })),
    );
    expect(result.audioReviewRequired).toBe(true);
    expect(result.sectionAverages.pronunciation).toBeNull();
    expect(result.overallScore).toBe(100);
  });
  test("oral averages below 85 cannot round up into a pass", () => {
    const exam = speakingFixture();
    const tasks = exam.tasks.map(task => parseTaskGrade(task, "Relevant response.", {
      scores: { vocabulary: 5, grammar: 4, coherence: 4, taskCompletion: 4 },
      feedback: "Adequate content.",
    }));
    expect(summarizeSpeaking(exam, "applicant", tasks).passed).toBe(true);
    tasks[0] = parseTaskGrade(exam.tasks[0]!, "Relevant response.", {
      scores: { vocabulary: 4, grammar: 4, coherence: 4, taskCompletion: 4 },
      feedback: "Adequate content.",
    });
    const below = summarizeSpeaking(exam, "applicant", tasks);
    expect(below.overallScore).toBe(84);
    expect(below.passed).toBe(false);
  });
  test("interview times use Manila including Sunday week boundaries", () => {
    expect(interviewStart("2026-10-25", "12:00 AM")).toBe(
      Date.parse("2026-10-24T16:00:00Z"),
    );
    expect(interviewStart("2026-10-25", "12:30 PM")).toBe(
      Date.parse("2026-10-25T04:30:00Z"),
    );
    expect(interviewWeek(0, Date.parse("2026-10-25T10:00:00Z"))).toEqual({
      weekStart: "2026-10-19",
      weekEnd: "2026-10-25",
    });
    for (const [date, time] of [
      ["2026-02-30", "1:00 PM"],
      ["2026-10-22", "13:00 PM"],
      ["2026-10-22", "01:00 PM"],
    ])
      expect(() => interviewStart(date!, time!)).toThrow();
  });
});
