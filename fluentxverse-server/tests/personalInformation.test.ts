import { expect, test } from "bun:test";
import {
  minimizeAIInput,
  privateInformationKinds,
  redactPrivateText,
} from "../src/privacy/personalInformation";
import { assertPrivateLessonNotes } from "../src/privacy/lessonNotePrivacy";
import { privateAgent, withAIPrivacy } from "../src/privacy/aiBoundary";

const identity = {
  names: ["Alice Tanaka", "Alice", "田中 花子", "José"],
  emails: ["alice@example.test"],
  addresses: ["123 Main Street"],
  identifiers: ["student-123"],
};
test("notes reject known student details throughout structured learning content", () => {
  for (const value of [
    "Hello Alice!",
    "alice tanaka improved.",
    "田中 花子さん",
    "José practiced reading.",
    "A student-123 note",
    "alice@example.test",
    "alice [at] example [dot] test",
    "123 Main Street",
    "+63 917 123 4567",
    "My address is nearby",
    "Student ID: abcdef",
    "A\u200blice",
    "Ａｌｉｃｅ",
    "Al&#105;ce",
    "A<b>li</b>ce",
    "Aliceさん",
    "&#65313;lice",
    "A&#8203;lice",
  ]) {
    expect(privateInformationKinds(value, identity).length).toBeGreaterThan(0);
    expect(() => assertPrivateLessonNotes({ grammar: [{ youSaid: value }] }, identity)).toThrow(
      "Remove student names",
    );
    expect(redactPrivateText(value, identity)).not.toContain("Alice");
  }
  expect(() =>
    assertPrivateLessonNotes(
      {
        studentComment: "The student used past tense accurately and practiced asking questions.",
        grammar: [{ youSaid: "I goes to school.", correct: "I go to school." }],
      },
      identity,
    ),
  ).not.toThrow();
  expect(() => assertPrivateLessonNotes("Malice is a vocabulary word.", identity)).not.toThrow();
});
test("AI input removes identity metadata and unnecessary history while preserving learning evidence", () => {
  expect(redactPrivateText("Alice can email alice@example.test", identity)).toBe(
    "[PRIVATE] can email [PRIVATE]",
  );
  const input = {
    studentId: "student-123",
    email: "alice@example.test",
    profile: { name: "Alice" },
    history: ["secret"],
    tutorMemos: ["secret"],
    level: 3,
    evidence: { grammar: "Alice goes to school.", score: 90, bookingId: "booking-secret" },
  };
  expect(minimizeAIInput(input, identity)).toEqual({
    level: 3,
    evidence: { grammar: "[PRIVATE] goes to school.", score: 90 },
  });
  expect(JSON.parse(minimizeAIInput(JSON.stringify(input), identity) as string)).toEqual(
    minimizeAIInput(input, identity),
  );
  expect(input.studentId).toBe("student-123");
  expect(minimizeAIInput({student:{name:'Unknown Student'},studentName:'Unknown Student',lesson:{name:'Past tense',level:3}},identity))
    .toEqual({lesson:{name:'Past tense',level:3}});
});
test("all agent generate calls redact inputs and do not leak provider errors", async () => {
  const calls: unknown[] = [];
  const agent = privateAgent({
    generate: async (input: unknown, options: unknown) => {
      calls.push([input, options]);
      return { text: "safe" };
    },
  });
  const signal = AbortSignal.timeout(1000);
  await withAIPrivacy(identity, () =>
    agent.generate("Alice can contact alice@example.test", { abortSignal: signal }),
  );
  expect(JSON.stringify(calls[0])).not.toContain("Alice");
  expect(JSON.stringify(calls[0])).not.toContain("alice@example.test");
  expect((calls[0] as any)[1].abortSignal).toBe(signal);
  const bad = privateAgent({
    generate: async () => {
      throw new Error("alice@example.test provider error");
    },
  });
  await expect(bad.generate()).rejects.toThrow("content were omitted");
  await expect(agent.generate("safe", { metadata: { email: "alice@example.test" } })).rejects.toThrow(
    "content were omitted",
  );
  expect(calls).toHaveLength(1);
});
test("concurrent requests never share identity context", async () => {
  const agent = privateAgent({ generate: async (value: string) => value });
  const a = withAIPrivacy({ names: ["Alice"] }, async () => {
    await new Promise((r) => setTimeout(r, 5));
    return agent.generate("Alice and Bob");
  });
  const b = withAIPrivacy({ names: ["Bob"] }, () => agent.generate("Alice and Bob"));
  expect(await a).toBe("[PRIVATE] and Bob");
  expect(await b).toBe("Alice and [PRIVATE]");
});
test('long unbroken input is bounded and does not trigger quadratic email scanning',()=>{
  const start=performance.now();
  expect(redactPrivateText('a'.repeat(200000))).toHaveLength(200000);
  expect(performance.now()-start).toBeLessThan(1000);
  expect(()=>minimizeAIInput('a'.repeat(200001))).toThrow('exceeds privacy limits');
});
