import { attendanceStartMs } from "../services/schedule.services/attendanceWindow";
import { PENALTY_CODE_DETAILS, type PenaltyCode } from "../config/penaltyCodes";
import { summarizeLessonSurveys } from './lessonSurvey';

export const RELIABILITY_WEIGHTS: Record<string, number> = {
	"301": 3,
	"302": 2,
	"303": 1,
};
const DAY = 86400_000;
const PHT = 8 * 3600_000;
export type MetricsPeriod = "month" | "30days" | "all";
type Row = Record<string, any>;
export function performanceWindow(
	period: string = "month",
	month?: string,
	now = Date.now(),
) {
	if (!["month", "30days", "all"].includes(period))
		throw new Error("Invalid metrics period");
	const currentMonth = new Date(now + PHT).toISOString().slice(0, 7);
	if (period === "month") {
		const selected = month || currentMonth;
		if (
			!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected) ||
			selected < "2000-01" ||
			selected > currentMonth
		)
			throw new Error("Choose a valid month up to the current month");
		const [year, m] = selected.split("-").map(Number);
		return {
			period: period as MetricsPeriod,
			month: selected,
			from: new Date(Date.UTC(year!, m! - 1, 1) - PHT).toISOString(),
			to: new Date(Date.UTC(year!, m!, 1) - PHT).toISOString(),
		};
	}
	return {
		period: period as MetricsPeriod,
		month: null,
		from: period === "30days" ? new Date(now - 30 * DAY).toISOString() : null,
		to: period === "30days" ? new Date(now).toISOString() : null,
	};
}
const rate = (numerator: number, denominator: number) =>
	denominator ? Math.round((numerator / denominator) * 1000) / 10 : null;
const duration = (row: Row) =>
	Number.isFinite(Number(row.durationMinutes)) &&
	Number(row.durationMinutes) > 0
		? Number(row.durationMinutes)
		: 25;
const codeOf = (value: unknown) =>
	String(value || "").replace(/^(TA|SUB|SYS|STU|BLK)-/, "");
const slotStart = (s: Row) => {
	try {
		return attendanceStartMs({
			date: String(s.slotDate),
			time: String(s.slotTime),
		});
	} catch {
		return NaN;
	}
};
export type LessonMetricOutcome =
	| "attended"
	| "tutor_absent"
	| "student_absent"
	| "awaiting_verification"
	| "upcoming"
	| "ongoing"
	| "cancelled"
	| "unclassified";
export function metricOutcome(b: Row, now: number): LessonMetricOutcome {
	if (b.status === "cancelled") return "cancelled";
	const start = Date.parse(b.slotDateTime);
	if (!Number.isFinite(start)) return "unclassified";
	if (start > now) return "upcoming";
	if (start + duration(b) * 60_000 > now) return "ongoing";
	if (b.attendanceTutor === "absent") return "tutor_absent";
	if (b.attendanceTutor === "present") return "attended";
	if (b.attendanceStudent === "absent") return "student_absent";
	return "awaiting_verification";
}

export function calculateTutorPerformance(
	bookings: Row[],
	slots: Row[],
	penalties: Row[],
	profile: Row,
	window: ReturnType<typeof performanceWindow>,
	now = Date.now(),
	page = 1,
	surveys: Row[] = [],
) {
	const includes = (timestamp: number) =>
		Number.isFinite(timestamp) &&
		(!window.from || timestamp >= Date.parse(window.from)) &&
		(!window.to || timestamp < Date.parse(window.to));
	const allBookings = new Map(bookings.map((b) => [b.bookingId, b]));
	const allSlots = new Map(slots.map((s) => [s.slotId, s]));
	const selected = bookings.filter(
		(b) =>
			includes(Date.parse(b.slotDateTime)) ||
			(window.period === "all" && !Number.isFinite(Date.parse(b.slotDateTime))),
	);
	const outcomes: Record<LessonMetricOutcome, number> = {
		attended: 0,
		tutor_absent: 0,
		student_absent: 0,
		awaiting_verification: 0,
		upcoming: 0,
		ongoing: 0,
		cancelled: 0,
		unclassified: 0,
	};
	const attendance = {
		present: 0,
		absent: 0,
		unverified: 0,
		rate: null as number | null,
	};
	const notes = {
		submitted: 0,
		pendingUpdates: 0,
		drafts: 0,
		overdue: 0,
		notRequired: 0,
		onTime: 0,
		submissionRate: null as number | null,
	};
	let teachingMinutes = 0;
	const eligibleBooked = new Set<string>();
	const recent = selected
		.map((b) => {
			const outcome = metricOutcome(b, now);
			outcomes[outcome]++;
			if (outcome === "cancelled") notes.notRequired++;
			if (outcome === "attended") teachingMinutes += duration(b);
			const ended = ![
				"upcoming",
				"ongoing",
				"cancelled",
				"unclassified",
			].includes(outcome);
			if (ended) {
				eligibleBooked.add(b.slotId || b.bookingId);
				if (b.attendanceTutor === "present") attendance.present++;
				else if (b.attendanceTutor === "absent") attendance.absent++;
				else attendance.unverified++;
				if (b.attendanceTutor === "absent" || b.attendanceStudent === "absent")
					notes.notRequired++;
				else {
					const originalDeadline =
						Date.parse(b.slotDateTime) + duration(b) * 60_000 + 48 * 3600_000;
					const deadline = Math.max(originalDeadline, Date.parse(b.notesReopenedUntil || '') || 0);
					if (b.notesSubmittedAt) {
						if (b.notesDraftDirty) {
							notes.pendingUpdates++;
							if (now >= deadline) notes.overdue++;
						} else notes.submitted++;
						if (Date.parse(b.notesSubmittedAt) <= originalDeadline) notes.onTime++;
					} else {
						notes.drafts++;
						if (now >= deadline) notes.overdue++;
					}
				}
			}
			return {
				bookingId: b.bookingId,
				startsAt: b.slotDateTime || null,
				durationMinutes: duration(b),
				studentName: b.studentName || "Student",
				outcome,
				notesStatus: outcome === 'cancelled' || b.attendanceTutor === 'absent' || b.attendanceStudent === 'absent'
					? "not_required"
					: !ended
						? "not_due"
						: b.notesSubmittedAt
							? b.notesDraftDirty
								? "changes_pending"
								: "submitted"
							: "draft",
			};
		})
		.sort(
			(a, b) => (Date.parse(b.startsAt || "") - Date.parse(a.startsAt || "")) || String(b.bookingId).localeCompare(String(a.bookingId)),
		);
	attendance.rate = rate(
		attendance.present,
		attendance.present + attendance.absent,
	);
	notes.submissionRate = rate(
		notes.submitted,
		notes.submitted + notes.drafts + notes.pendingUpdates,
	);

	const occupied = new Set(
		bookings
			.filter((b) => b.status !== "cancelled")
			.map((b) => b.slotId)
			.filter(Boolean),
	);
	const bookedSlots = new Set(selected.filter(b => b.status !== 'cancelled' && Number.isFinite(Date.parse(b.slotDateTime))).map(b => b.slotId || b.bookingId));
	// Count published opportunities, not unpublished availability or cancelled booking attempts.
	const bookableSlots = new Set(slots.filter(s => includes(slotStart(s)) &&
		(['open', 'pending', 'booked'].includes(s.status) || s.openedAt || s.attendanceMarked || s.penaltyCode || s.ta303Count))
		.map(s => s.slotId));
	for (const id of bookedSlots) bookableSlots.add(id);
	const cancellationEligible = new Set(slots.filter(s => bookableSlots.has(s.slotId) &&
		includes(slotStart(s)) && slotStart(s) + duration(s) * 60_000 <= now).map(s => s.slotId));
	for (const b of selected) {
		const start = Date.parse(b.slotDateTime);
		if (includes(start) && start + duration(b) * 60_000 <= now)
			cancellationEligible.add(b.slotId || b.bookingId);
	}
	const affectedSlots = new Set<string>();
	const unbooked = slots.filter(
		(s) =>
			includes(slotStart(s)) &&
			slotStart(s) + duration(s) * 60_000 <= now &&
			!occupied.has(s.slotId) &&
			(["open", "pending"].includes(s.status) ||
				s.attendanceMarked ||
				s.penaltyCode ||
				s.ta303Count),
	);
	const available = new Set(unbooked.map((s) => s.slotId));
	// One physical slot contributes once, even after cancellation/rebooking.
	const eligible = new Set([...eligibleBooked, ...available]);
	const seenAbsences = new Set<string>();
	const penaltyCounts: Record<string, number> = {};
	const incidents = [...penalties]
		.sort(
			(a, b) =>
				Number(Boolean(a.revokedAt || a.status === "voided")) -
				Number(Boolean(b.revokedAt || b.status === "voided")),
		)
		.flatMap((p) => {
			const b = allBookings.get(p.bookingId),
				s = allSlots.get(p.slotId || b?.slotId);
			const startsAt = b
				? Date.parse(b.slotDateTime)
				: s
					? slotStart(s)
					: Date.parse(p.createdAt);
			if (
				!includes(startsAt) ||
				startsAt + duration(b || s || {}) * 60_000 > now
			)
				return [];
			const code = codeOf(p.penaltyCode);
			const slotId = b?.slotId || b?.bookingId || s?.slotId;
			const invalidPenalty = p.status === "voided" || p.revokedAt ||
				(code === "301" && b?.attendanceTutor === "present") ||
				(code === "302" && s?.attendanceMarked === "present");
			if (["301", "302", "303"].includes(code) && !invalidPenalty && cancellationEligible.has(slotId))
				affectedSlots.add(slotId);
			const key = `${code}:${p.bookingId || p.slotId || p.penaltyId}`;
			if (code === "301" || code === "302") {
				if (seenAbsences.has(key)) return [];
				seenAbsences.add(key);
			}
			const excluded =
				!eligible.has(b?.slotId || b?.bookingId || s?.slotId) ||
				p.status === "voided" ||
				p.revokedAt ||
				(code === "301" && b?.attendanceTutor === "present") ||
				(code === "302" && s?.attendanceMarked === "present");
			const points = excluded ? 0 : RELIABILITY_WEIGHTS[code] || 0;
			if (!excluded) penaltyCounts[code] = (penaltyCounts[code] || 0) + 1;
			const reference = PENALTY_CODE_DETAILS[code as PenaltyCode];
			return [
				{
					id: p.penaltyId || key,
					bookingId: p.bookingId || null,
					code: reference?.label || code,
					reason: p.penaltyReason || reference?.description || "",
					createdAt: p.createdAt || null,
					startsAt: Number.isFinite(startsAt)
						? new Date(startsAt).toISOString()
						: null,
					points,
					excludedFromScore: Boolean(excluded),
				},
			];
		})
		.sort(
			(a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""),
		);
	const penaltyPoints = incidents.reduce((sum, p) => sum + p.points, 0);
	const score = eligible.size
		? Math.max(
				0,
				Math.round(((eligible.size - penaltyPoints) / eligible.size) * 1000) /
					10,
			)
		: null;
	const trend = new Map<
		string,
		{
			date: string;
			attended: number;
			tutorAbsent: number;
			studentAbsent: number;
			unverified: number;
			minutes: number;
		}
	>();
	const monthly = window.period === "all";
	const startDay = window.from
		? Date.parse(window.from)
		: Date.UTC(
				new Date(now + PHT).getUTCFullYear(),
				new Date(now + PHT).getUTCMonth() - 11,
				1,
			) - PHT;
	const endDay = Math.min(window.to ? Date.parse(window.to) : now, now);
	for (let t = startDay; t <= endDay; t += DAY) {
		const key = new Date(t + PHT).toISOString().slice(0, monthly ? 7 : 10);
		if (!trend.has(key))
			trend.set(key, {
				date: key,
				attended: 0,
				tutorAbsent: 0,
				studentAbsent: 0,
				unverified: 0,
				minutes: 0,
			});
	}
	for (const b of selected) {
		if (!Number.isFinite(Date.parse(b.slotDateTime))) continue;
		const item = trend.get(
			new Date(Date.parse(b.slotDateTime) + PHT)
				.toISOString()
				.slice(0, monthly ? 7 : 10),
		);
		if (!item) continue;
		const outcome = metricOutcome(b, now);
		if (outcome === "attended") {
			item.attended++;
			item.minutes += duration(b);
		}
		if (outcome === "tutor_absent") item.tutorAbsent++;
		if (outcome === "student_absent") item.studentAbsent++;
		if (outcome === "awaiting_verification") item.unverified++;
	}
	const reviews = Number.isFinite(Number(profile.totalReviews))
		? Math.max(0, Math.floor(Number(profile.totalReviews) || 0))
		: 0;
	const rating = Number(profile.rating);
	return {
		period: window,
		timezone: "Asia/Manila",
		generatedAt: new Date(now).toISOString(),
		slots: { bookable: bookableSlots.size, booked: bookedSlots.size },
		lessons: {
			total: selected.length,
			...outcomes,
			teachingMinutes,
			teachingHours: Math.round((teachingMinutes / 60) * 100) / 100,
		},
		attendance,
		notes,
		cancellation: {
			rate: rate(affectedSlots.size, cancellationEligible.size),
			affectedSlots: affectedSlots.size,
			eligibleSlots: cancellationEligible.size,
		},
		reliability: {
			score,
			eligibleSlots: eligible.size,
			bookedSlots: eligibleBooked.size,
			unbookedSlots: available.size,
			penaltyPoints,
			penaltyCounts,
			weights: RELIABILITY_WEIGHTS,
		},
		trend: [...trend.values()],
		recentLessons: recent.slice((page - 1) * 20, page * 20),
		page,
		pageSize: 20,
		totalPages: Math.ceil(recent.length / 20),
		penalties: incidents.slice(0, 20),
		penaltyTotal: incidents.length,
		rating: {
			average: reviews && rating >= 1 && rating <= 5 ? rating : null,
			totalReviews: reviews,
			scope: "all_time",
			distribution: null,
		},
		survey: summarizeLessonSurveys(surveys.filter(s => {
			const b = allBookings.get(s.bookingId);
			if (!b) return false;
			const start = Date.parse(b.slotDateTime), submitted = Date.parse(s.submittedAt);
			// A survey may be submitted after a tutor finishes before the scheduled end.
			return includes(start) && start <= now && (start + duration(b) * 60_000 <= now || (submitted >= start && submitted <= now));
		})),
		penaltyReference: Object.values(PENALTY_CODE_DETAILS).map((p) => ({
			code: p.label,
			description: p.description,
			weight: RELIABILITY_WEIGHTS[p.code] || 0,
		})),
	};
}
