import { describe, expect, test } from "bun:test";
import {
	calculateTutorPerformance,
	metricOutcome,
	performanceWindow,
} from "../src/utils/tutorPerformance";
const now = Date.parse("2026-10-07T08:00:00Z");
const window = performanceWindow("month", "2026-10", now);
const booking = (id: string, fields: Record<string, any> = {}) => ({
	bookingId: id,
	slotId: id,
	slotDateTime: "2026-10-06T08:00:00Z",
	durationMinutes: 25,
	status: "completed",
	attendanceTutor: "present",
	attendanceStudent: "present",
	...fields,
});
const slot = (id: string, fields: Record<string, any> = {}) => ({
	slotId: id,
	slotDate: "2026-10-06",
	slotTime: "4:00 PM",
	durationMinutes: 25,
	status: "open",
	...fields,
});
const calculate = (
	bookings: any[] = [],
	slots: any[] = [],
	penalties: any[] = [],
	range = window,
	page = 1,
) =>
	calculateTutorPerformance(bookings, slots, penalties, {}, range, now, page);
describe("tutor performance", () => {
	test('scheduling summary counts published slots once and excludes cancelled booking attempts', () => {
		const data = calculate([
			booking('original', { slotId: 'booked', status: 'cancelled' }),
			booking('replacement', { slotId: 'booked' }),
			booking('future-booking', { slotId: 'future', slotDateTime: '2026-10-08T08:00:00Z', status: 'confirmed' }),
		], [slot('booked', { status: 'booked' }), slot('open'), slot('open'),
			slot('future', { slotDate: '2026-10-08', status: 'booked' }),
			slot('closed-published', { status: 'closed', openedAt: '2026-10-01T00:00:00Z' }),
			slot('unpublished', { status: 'available' }), slot('closed-never-published', { status: 'closed' }),
			slot('outside', { slotDate: '2026-09-30' })]);
		expect(data.slots).toEqual({ bookable: 4, booked: 2 });
		expect(calculate().slots).toEqual({ bookable: 0, booked: 0 });
	});
	test('rolling 30 days includes its start boundary but excludes older and future lessons', () => {
		const range = performanceWindow('30days', undefined, now);
		const d = calculate([booking('start', { slotDateTime: range.from }), booking('older', { slotDateTime: new Date(Date.parse(range.from!) - 1).toISOString() }), booking('future', { slotDateTime: new Date(now + 1).toISOString() })], [], [], range);
		expect(d.lessons.total).toBe(1);
		expect(d.recentLessons[0]?.bookingId).toBe('start');
	});
	test("unlinked penalties cannot lower the score for unrelated eligible slots", () => {
		const d = calculate(
			[booking("valid")],
			[],
			[
				{
					penaltyId: "orphan",
					penaltyCode: "301",
					createdAt: "2026-10-06T08:00:00Z",
				},
			],
		);
		expect(d.reliability.score).toBe(100);
		expect(d.penalties[0]?.excludedFromScore).toBe(true);
	});
	test("voided duplicate absence records cannot hide an active penalty", () => {
		const d = calculate(
			[booking("absent", { attendanceTutor: "absent" })],
			[],
			[
				{
					penaltyId: "old",
					bookingId: "absent",
					penaltyCode: "301",
					status: "voided",
				},
				{ penaltyId: "active", bookingId: "absent", penaltyCode: "301" },
			],
		);
		expect(d.reliability.penaltyPoints).toBe(3);
		expect(d.penalties[0]?.id).toBe("active");
	});
	test("PHT month boundaries are independent of server timezone", () => {
		expect(window.from).toBe("2026-09-30T16:00:00.000Z");
		expect(window.to).toBe("2026-10-31T16:00:00.000Z");
		expect(
			performanceWindow("month", undefined, Date.parse("2026-09-30T17:00:00Z"))
				.month,
		).toBe("2026-10");
		expect(() => performanceWindow("month", "2026-13", now)).toThrow();
		expect(() => performanceWindow("month", "2026-11", now)).toThrow();
		expect(() => performanceWindow("unknown", undefined, now)).toThrow();
	});
	test("empty data has no invented rating, attendance, or reliability", () => {
		const d = calculate();
		expect(d.lessons.total).toBe(0);
		expect(d.attendance.rate).toBeNull();
		expect(d.reliability.score).toBeNull();
		expect(d.cancellation).toEqual({ rate: null, affectedSlots: 0, eligibleSlots: 0 });
		expect(d.rating.average).toBeNull();
		expect(d.notes.submissionRate).toBeNull();
	});
	test("outcomes partition bookings and confirmed ended bookings use actual attendance", () => {
		const data = calculate([
			booking("attended", { status: "confirmed", durationMinutes: 50 }),
			booking("tutor", { attendanceTutor: "absent" }),
			booking("student", { attendanceStudent: "absent" }),
			booking("unverified", { attendanceStudent: null }),
			booking("future", { slotDateTime: "2026-10-08T08:00:00Z" }),
			booking("ongoing", { slotDateTime: "2026-10-07T07:50:00Z" }),
			booking("cancelled", { status: "cancelled" }),
		]);
		expect(data.lessons).toMatchObject({
			total: 7,
			attended: 3,
			tutor_absent: 1,
			student_absent: 0,
			awaiting_verification: 0,
			upcoming: 1,
			ongoing: 1,
			cancelled: 1,
			teachingMinutes: 100,
			teachingHours: 1.67,
		});
		expect(data.attendance).toMatchObject({ present: 3, absent: 1, rate: 75 });
		expect(data.notes.notRequired).toBe(3);
		expect(data.recentLessons.find(lesson => lesson.bookingId === 'cancelled')?.notesStatus).toBe('not_required');
	});
	test("future, default present, and premature completed statuses never inflate hours", () => {
		expect(
			metricOutcome(
				booking("future", { slotDateTime: "2026-10-09T08:00:00Z" }),
				now,
			),
		).toBe("upcoming");
		expect(
			calculate([booking("pending", { attendanceStudent: null })]).lessons
				.teachingMinutes,
		).toBe(25);
		expect(
			calculate([booking("pending", { attendanceTutor: null })]).attendance
				.rate,
		).toBeNull();
	});
	test("notes distinguish drafts, updates, absent lessons, and the exact deadline", () => {
		const start = new Date(now - 48 * 3600_000 - 25 * 60_000).toISOString();
		const d = calculate([
			booking("draft", { slotDateTime: start }),
			booking("submitted", {
				notesSubmittedAt: new Date(now - 3600_000).toISOString(),
			}),
			booking("updates", {
				slotDateTime: start,
				notesSubmittedAt: new Date(now - 3600_000).toISOString(),
				notesDraftDirty: true,
			}),
			booking("absent", { attendanceStudent: "absent" }),
		]);
		expect(d.notes).toMatchObject({
			submitted: 1,
			pendingUpdates: 1,
			drafts: 1,
			overdue: 2,
			notRequired: 1,
			submissionRate: 33.3,
		});
	});
	test("reliability counts each physical slot once and excludes unpublished/future slots", () => {
		const data = calculate(
			[
				booking("booked"),
				booking("replacement", { slotId: "booked" }),
				booking("old", { slotId: "booked", status: "cancelled" }),
			],
			[
				slot("booked", { status: "booked" }),
				slot("open"),
				slot("unpublished", { status: "available" }),
				slot("future", { slotDate: "2026-10-08" }),
			],
		);
		expect(data.reliability).toMatchObject({
			eligibleSlots: 2,
			bookedSlots: 1,
			unbookedSlots: 1,
			score: 100,
		});
	});
	test("canonical weights, repeated legitimate TA-303s, and zero scores survive", () => {
		const data = calculate(
			[booking("absent", { attendanceTutor: "absent" })],
			[
				slot("missed", { penaltyCode: "302" }),
				slot("cancelled", { status: "available", ta303Count: 2 }),
			],
			[
				{ penaltyId: "a", bookingId: "absent", penaltyCode: "301" },
				{ penaltyId: "duplicate", bookingId: "absent", penaltyCode: "TA-301" },
				{ penaltyId: "b", slotId: "missed", penaltyCode: "302" },
				{ penaltyId: "c", slotId: "cancelled", penaltyCode: "303" },
				{ penaltyId: "d", slotId: "cancelled", penaltyCode: "303" },
			],
		);
		expect(data.reliability.penaltyPoints).toBe(7);
		expect(data.reliability.score).toBe(0);
		expect(data.reliability.penaltyCounts).toEqual({
			"301": 1,
			"302": 1,
			"303": 2,
		});
		expect(data.penaltyTotal).toBe(4);
		expect(data.cancellation).toEqual({ rate: 100, affectedSlots: 3, eligibleSlots: 3 });
	});
	test("admin attendance corrections and revoked penalties do not reduce reliability", () => {
		const data = calculate(
			[booking("corrected")],
			[slot("corrected-open", { attendanceMarked: "present" })],
			[
				{ bookingId: "corrected", penaltyCode: "301" },
				{ slotId: "corrected-open", penaltyCode: "302" },
				{ slotId: "corrected-open", penaltyCode: "303", status: "voided" },
			],
		);
		expect(data.reliability.score).toBe(100);
		expect(data.reliability.penaltyPoints).toBe(0);
		expect(data.penalties.every((p) => p.excludedFromScore)).toBe(true);
		expect(data.cancellation).toEqual({ rate: 0, affectedSlots: 0, eligibleSlots: 2 });
	});
	test("cancellation ratio counts physical slots, not penalty weights or booking attempts", () => {
		const data = calculate([
			booking("old", { slotId: "shared", status: "cancelled" }),
			booking("replacement", { slotId: "shared" }),
			booking("cancelled-booking", { status: "cancelled", attendanceTutor: "absent" }),
		], [
			slot("shared", { status: "booked" }),
			slot("closed", { status: "closed", openedAt: "2026-10-01T00:00:00Z" }),
			slot("clean"), slot("other-issues"),
			slot("unpublished", { status: "available" }),
			slot("future", { slotDate: "2026-10-08" }),
			slot("outside", { slotDate: "2026-09-30" }),
		], [
			{ bookingId: "old", penaltyCode: "303" },
			{ bookingId: "replacement", penaltyCode: "303" },
			{ slotId: "closed", penaltyCode: "303" },
			{ slotId: "closed", penaltyCode: "TA-303" },
			{ bookingId: "cancelled-booking", penaltyCode: "301" },
			{ slotId: "other-issues", penaltyCode: "401" },
			{ slotId: "other-issues", penaltyCode: "501" },
			{ slotId: "clean", penaltyCode: "303", revokedAt: "2026-10-07T00:00:00Z" },
			{ slotId: "unpublished", penaltyCode: "303" },
			{ slotId: "future", penaltyCode: "303" },
			{ slotId: "outside", penaltyCode: "303" },
			{ penaltyCode: "303", createdAt: "2026-10-06T08:00:00Z" },
		]);
		expect(data.cancellation).toEqual({ rate: 60, affectedSlots: 3, eligibleSlots: 5 });
	});
	test("cancellation ratio rounds percentages without inventing a penalty for student absence", () => {
		const data = calculate([booking("student-absent", { attendanceStudent: "absent" })],
			[slot("affected"), slot("clean")], [{ slotId: "affected", penaltyCode: "303" }]);
		expect(data.cancellation).toEqual({ rate: 33.3, affectedSlots: 1, eligibleSlots: 3 });
	});
	test("scheduled dates, not edit or penalty creation dates, select the period", () => {
		const data = calculate(
			[
				booking("outside", {
					slotDateTime: "2026-09-30T15:59:59Z",
					attendanceTutor: "absent",
				}),
				booking("inside", { slotDateTime: "2026-09-30T16:00:00Z" }),
			],
			[],
			[
				{
					bookingId: "outside",
					penaltyCode: "301",
					createdAt: "2026-10-01T10:00:00Z",
				},
			],
		);
		expect(data.lessons.total).toBe(1);
		expect(data.reliability.penaltyPoints).toBe(0);
		expect(data.trend.find((d) => d.date === "2026-10-01")?.attended).toBe(1);
	});
	test("all-time totals are uncapped while details paginate and the trend is bounded", () => {
		const d = calculate(
			Array.from({ length: 45 }, (_, i) => booking(String(i))),
			[],
			[],
			performanceWindow("all", undefined, now),
			2,
		);
		expect(d.lessons.total).toBe(45);
		expect(d.recentLessons).toHaveLength(20);
		expect(d.totalPages).toBe(3);
		expect(d.trend).toHaveLength(12);
		expect(
			calculate(
				[booking("broken", { slotDateTime: undefined })],
				[],
				[],
				performanceWindow("all", undefined, now),
			).lessons.unclassified,
		).toBe(1);
	});
});
