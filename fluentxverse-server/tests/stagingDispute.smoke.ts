import assert from "node:assert/strict";
import { initDriver, getDriver, closeDriver } from "../src/db/memgraph";
import { StudentDisputeService } from "../src/services/studentDispute.service";
import { signAuthToken } from "../src/utils/jwt";
if (
	process.env.MEMGRAPH_URI !== "bolt://graph:7687" ||
	process.env.REFUND_TRANSFERS_DISABLED !== "true" ||
	process.env.GMR_ENGINE_API_KEY
)
	throw Error("Isolated staging required");
await initDriver(process.env.MEMGRAPH_URI, "", "");
const db = getDriver().session(),
	service = new StudentDisputeService();
const suffix = crypto.randomUUID(),
	student = "stage-student-" + suffix,
	tutor = "stage-tutor-" + suffix,
	bookingId = "stage-lesson-" + suffix;
try {
	await db.run(
		`CREATE(s:Student {id:$student,email:'synthetic@example.invalid'}),(:User {id:$tutor}),
    (b:Booking {bookingId:$bookingId,studentId:$student,tutorId:$tutor,status:'completed',paymentMethod:'trial',attendanceSource:'admin',attendanceTutor:'present',slotDateTime:datetime($start),durationMinutes:25})-[:BOOKED_BY]->(s)
    CREATE(b)-[:BOOKS]->(:TimeSlot {slotId:$bookingId,status:'booked'})`,
		{
			student,
			tutor,
			bookingId,
			start: new Date(Date.now() - 1800000).toISOString(),
		},
	);
	const report = await service.create(
		bookingId,
		student,
		"tutor",
		"Synthetic staging late-arrival case",
		"late_join",
	);
	assert(report);
	await service.reconcile();
	const tutorToken = await signAuthToken({
			userId: tutor,
			role: "tutor",
			email: "synthetic@example.invalid",
		}),
		studentToken = await signAuthToken({
			userId: student,
			role: "student",
			email: "synthetic@example.invalid",
		});
	const api = async (
		role: string,
		token: string,
		path: string,
		body?: any,
		origin?: string,
	) => {
		const r = await fetch(
			"http://127.0.0.1:8765/inbox/disputes/" + path + "?as=" + role,
			{
				method: body ? "POST" : "GET",
				headers: {
					cookie: role + "Auth=" + token,
					...(body
						? {
								"Content-Type": "application/json",
								origin: origin || `https://${role}.fluentxverse.com`,
							}
						: {}),
				},
				body: body ? JSON.stringify(body) : undefined,
			},
		);
		return { status: r.status, body: (await r.json()) as any };
	};
	assert.equal(
		(
			await api(
				"tutor",
				tutorToken,
				report.id + "/reply",
				{ text: "hi" },
				"https://evil.example",
			)
		).status,
		403,
	);
	const replied = await api("tutor", tutorToken, report.id + "/reply", {
		text: "Staging explanation for staff only",
		duration: "up_to_ten",
		reason: "connection",
	});
	assert.equal(replied.status, 200, JSON.stringify(replied.body));
	const privateView = await api("student", studentToken, "");
	assert.equal(privateView.status, 200);
	assert.equal(
		privateView.body.data.find((c: any) => c.id === report.id).replies.length,
		0,
	);
	await db.run("MATCH(t:LessonIssueThread {id:$id}) SET t.deadline=$past", {
		id: report.id,
		past: new Date(Date.now() - 1000).toISOString(),
	});
	await service.reconcile();
	assert.equal(
		(await service.list({ id: tutor, role: "tutor" })).find(
			(c) => c.id === report.id,
		)?.state,
		"ta301",
	);
	assert.notEqual(
		(
			await api("tutor", tutorToken, report.id + "/reply", {
				text: "Late submission",
			})
		).status,
		200,
	);
	assert.equal(
		(
			await api("tutor", tutorToken, report.id + "/followup", {
				text: "Decision reply",
			})
		).status,
		403,
	);
	assert.equal(
		(
			await api("student", studentToken, report.id + "/followup", {
				text: "Private follow-up to staff",
			})
		).status,
		200,
	);
	const imageBooking = bookingId + "-image";
	await db.run(
		`MATCH(s:Student {id:$student}) CREATE(b:Booking {bookingId:$imageBooking,studentId:$student,tutorId:$tutor,status:'completed',paymentMethod:'trial',attendanceSource:'admin',attendanceTutor:'present',slotDateTime:datetime($start),durationMinutes:25})-[:BOOKED_BY]->(s)`,
		{
			student,
			tutor,
			imageBooking,
			start: new Date(Date.now() - 1800000).toISOString(),
		},
	);
	const imageCase = await service.create(
		imageBooking,
		student,
		"tutor",
		"Synthetic image evidence case",
		"late_join",
	);
	assert(imageCase);
	await service.reconcile();
	const png = Bun.spawnSync([
		"ffmpeg",
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=16x16",
		"-frames:v",
		"1",
		"-threads",
		"1",
		"-f",
		"image2pipe",
		"-c:v",
		"png",
		"pipe:1",
	]);
	assert.equal(png.exitCode, 0);
	const form = new FormData();
	form.set("text", "Synthetic private image evidence");
	form.append(
		"images",
		new File([png.stdout], "evidence.png", { type: "image/png" }),
	);
	const upload = await fetch(
		`http://127.0.0.1:8765/inbox/disputes/${imageCase.id}/images?as=tutor`,
		{
			method: "POST",
			headers: {
				cookie: "tutorAuth=" + tutorToken,
				origin: "https://tutor.fluentxverse.com",
			},
			body: form,
		},
	);
	assert.equal(upload.status, 200, await upload.text());
	const imageId = (await service.list({ id: tutor, role: "tutor" })).find(
		(c) => c.id === imageCase.id,
	)!.replies[0].attachments[0].id;
	const url = `http://127.0.0.1:8765/inbox/disputes/${imageCase.id}/images/${imageId}`;
	const image = await fetch(url + "?as=tutor", {
		headers: { cookie: "tutorAuth=" + tutorToken },
	});
	assert.equal(image.status, 200);
	assert.equal(image.headers.get("content-type"), "image/jpeg");
	const denied = await fetch(url + "?as=student", {
		headers: { cookie: "studentAuth=" + studentToken },
	});
	assert.equal(denied.status, 404);
	console.log(
		JSON.stringify({
			passed: true,
			synthetic: true,
			caseId: report.id,
			realTransfersDisabled: true,
			checks: [
				"real-http-origins",
				"private-evidence",
				"deadline-penalty",
				"read-only-tutor-decision",
				"student-staff-followup",
			],
		}),
	);
} finally {
	await db.close();
	await closeDriver();
}
