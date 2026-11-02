import { expect, test } from "bun:test";
import {
	disputeReplyState,
	disputeText,
	disputeReasons,
	disputeFailure,
} from "../src/services/studentDispute.policy";
import { payableCompletion } from "../src/services/admin.services/tutorEarnings.service";
test('application-wide dispute errors retain safe statuses without exposing private input',()=>{
  expect(disputeFailure(new Error('A reply has already been sent.')).status).toBe(409);
  expect(disputeFailure(new Error('Conversation not found')).status).toBe(404);
  expect(disputeFailure(new Error('private evidence content'),'VALIDATION').body.error).toBe('Invalid case request.');
  expect(disputeFailure(new Error('database credentials')).body.error).not.toContain('credentials');
});
test("duration routing across all reasons", () => {
	for (const reason of disputeReasons) {
		expect(disputeReplyState("up_to_ten", reason)).toBe(
			reason === "other" ? "awaiting_admin" : "pending_ta301",
		);
		expect(disputeReplyState("over_ten", reason)).toBe("awaiting_admin");
	}
	expect(disputeReplyState()).toBe("awaiting_admin");
	expect(() => disputeReplyState("invalid", "connection")).toThrow();
});
test("short and image-only replies count, empty requests do not", () => {
	expect(disputeText("hi")).toBe("hi");
	expect(disputeText("", 1)).toBe("");
	expect(() => disputeText("")).toThrow();
});
test("dispute holds block payable earnings, no penalty can retain pay despite refund", () => {
	const b = {
		status: "completed",
		lessonOutcome: "attended",
		attendanceTutor: "present",
		attendanceStudent: "present",
		slotDateTime: "2026-10-20T10:00:00Z",
		finalizedAt: "2026-10-20T11:00:00Z",
	};
	expect(() => payableCompletion({ ...b, disputeHold: true })).toThrow();
	expect(() => payableCompletion({ ...b, refunded: true })).toThrow();
	expect(() =>
		payableCompletion({
			...b,
			refunded: true,
			issueDecision: "no_penalty",
			refundStatus: "completed",
		}),
	).not.toThrow();
	expect(() =>
		payableCompletion(b, Date.parse("2026-10-21T10:00:00Z")),
	).toThrow();
});
