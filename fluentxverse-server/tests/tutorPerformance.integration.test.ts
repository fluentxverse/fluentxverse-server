import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import Elysia from "elysia";
import Tutor from "../src/routes/tutor.route";
import { initDriver, getDriver, closeDriver } from "../src/db/memgraph";
import { signAuthToken } from "../src/utils/jwt";
import { TutorPerformanceService } from "../src/services/tutorPerformance.service";

const suite = process.env.LESSON_NOTES_TEST_URI ? describe : describe.skip;
const prefix = `performance-test-${crypto.randomUUID()}`;
const tutor = `${prefix}-tutor`,
	other = `${prefix}-other`;
const service = new TutorPerformanceService();
const app = new Elysia().use(Tutor);
const run = async (query: string, params: Record<string, any> = {}) => {
	const session = getDriver().session();
	try {
		return await session.run(query, params);
	} finally {
		await session.close();
	}
};
let cookie = "";
const request = (suffix = "", auth = cookie) =>
	app.handle(
		new Request(`http://localhost/tutor/performance${suffix}`, {
			headers: { cookie: auth },
		}),
	);
suite("tutor performance API (Memgraph)", () => {
	beforeAll(async () => {
		await initDriver(
			process.env.LESSON_NOTES_TEST_URI!,
			process.env.MEMGRAPH_USER || "fluentxverse",
			process.env.MEMGRAPH_PASSWORD || "",
			1,
		);
		cookie = `tutorAuth=${await signAuthToken({ userId: tutor, email: "metrics@test.local", role: "tutor" })}`;
		await run(
			`CREATE (:User {id: $tutor, totalSessions: 999, rating: '4.8', totalReviews: '12'}), (:User {id: $other}), (:Student {id: $student, givenName: 'Metrics', familyName: 'Student'})`,
			{ tutor, other, student: `${prefix}-student` },
		);
		await run(
			`MATCH (s:Student {id: $student})
      CREATE (:Booking {bookingId: $id, tutorId: $tutor, slotId: $id, slotDateTime: datetime($start), status: 'confirmed', durationMinutes: 50,
        attendanceTutor: 'present', attendanceStudent: 'present', notesSubmittedAt: $submitted})-[:BOOKED_BY]->(s)
      CREATE (:Booking {bookingId: $otherId, tutorId: $other, slotDateTime: datetime($start), status: 'completed', durationMinutes: 25,
        attendanceTutor: 'absent', attendanceStudent: 'absent'})-[:BOOKED_BY]->(s)`,
			{
				student: `${prefix}-student`,
				id: `${prefix}-booking`,
				otherId: `${prefix}-other-booking`,
				tutor,
				other,
				start: new Date(Date.now() - 3 * 3600_000).toISOString(),
				submitted: new Date(Date.now() - 3600_000).toISOString(),
			},
		);
	});
	afterAll(async () => {
		await run(
			"MATCH (n) WHERE n.id STARTS WITH $prefix OR n.bookingId STARTS WITH $prefix OR n.userId IN $users DETACH DELETE n",
			{ prefix, users: [tutor, other] },
		);
		await closeDriver();
	});
	test("requires authenticated tutor role, including signed tokens with the wrong role", async () => {
		expect((await request("", "")).status).toBe(401);
		const studentToken = await signAuthToken({
			userId: tutor,
			email: "student@test.local",
			role: "student",
		});
		expect((await request("", `tutorAuth=${studentToken}`)).status).toBe(401);
	});
	test("reads actual owned bookings, not stale profile totals or another tutor", async () => {
		const response = await request("?period=all");
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		const { data } = (await response.json()) as any;
		expect(data.lessons.total).toBe(1);
		expect(data.lessons.attended).toBe(1);
		expect(data.lessons.teachingMinutes).toBe(50);
		expect(data.attendance.rate).toBe(100);
		expect(data.notes.submitted).toBe(1);
		expect(data.reliability.score).toBe(100);
		expect(data.rating).toMatchObject({
			average: 4.8,
			totalReviews: 12,
			distribution: null,
		});
		expect(data.recentLessons[0].studentName).toBe("Metrics Student");
		expect(JSON.stringify(data)).not.toContain(`${prefix}-other-booking`);
	});
	test("invalid periods, months, and pagination are rejected rather than defaulting to zero", async () => {
		for (const suffix of [
			"?period=banana",
			"?month=2026-99",
			"?page=NaN",
			"?page=0",
			"?page=1.5",
		])
			expect((await request(suffix)).status).toBe(400);
	});
	test("corrections and submission changes are reflected immediately without cached totals", async () => {
		await run(
			`MATCH (b:Booking {bookingId: $id}) SET b.attendanceStudent = 'absent'`,
			{ id: `${prefix}-booking` },
		);
		const absent = await service.get(tutor, "all");
		expect(absent.lessons.attended).toBe(1);
		expect(absent.lessons.teachingMinutes).toBe(50);
		expect(absent.notes.notRequired).toBe(1);
		await run(
			`MATCH (b:Booking {bookingId: $id}) SET b.attendanceStudent = 'present', b.notesDraftDirty = true`,
			{ id: `${prefix}-booking` },
		);
		const changed = await service.get(tutor, "all");
		expect(changed.lessons.attended).toBe(1);
		expect(changed.notes.pendingUpdates).toBe(1);
		expect(changed.notes.submissionRate).toBe(0);
	});
	(process.env.PERFORMANCE_LIVE_TEST_URL ? test : test.skip)('deployed API uses the same authenticated source of truth', async () => {
		const response = await fetch(`${process.env.PERFORMANCE_LIVE_TEST_URL}/tutor/performance?period=all`, { headers: { cookie } });
		expect(response.status).toBe(200);
		const { data } = await response.json() as any;
		expect(data.lessons.total).toBe(1);
		expect(data.lessons.attended).toBe(1);
		expect(data.notes.pendingUpdates).toBe(1);
	});
});
