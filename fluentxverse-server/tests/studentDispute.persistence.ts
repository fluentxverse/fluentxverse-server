import assert from "node:assert/strict";
import Elysia from "elysia";
import { initDriver, getDriver, closeDriver } from "../src/db/memgraph";
import { StudentDisputeService } from "../src/services/studentDispute.service";
import { REPLY_WINDOW } from "../src/services/studentDispute.policy";
import Routes from "../src/routes/studentDispute.route";
import { signAuthToken } from "../src/utils/jwt";
import { CancellationRefundService } from "../src/services/ticket.services/cancellationRefund.service";
import { assertTrialAllowance } from "../src/services/schedule.services/trialPolicy";
import { disputeEvents, appendDisputeEvent, DISPUTE_POLICY_HASH } from "../src/services/disputeChain/outbox";
import { disputeChainRoute } from "../src/routes/disputeChain.route";
if (process.env.ISSUE_TEST_URI !== "bolt://127.0.0.1:17729")
	throw Error("Disposable graph on port 17729 required");
process.env.JWT_SECRET = "disposable-dispute-test-secret";
process.env.DISPUTE_CHAIN_CAPTURE = "true";
process.env.DISPUTE_CHAIN_FEED_KEY = "disposable-feed-secret-with-at-least-32-characters";
await initDriver(process.env.ISSUE_TEST_URI, "", "");
const db = getDriver().session();
let now = Date.parse("2026-10-31T10:03:00Z");
const service = new StudentDisputeService(() => now);
const tutor = { id: "tutor", role: "tutor" as const },
	student = { id: "student", role: "student" as const },
	admin = { id: "staff", role: "admin" as const };
try {
	assert.equal(
		(await db.run("MATCH(n) RETURN count(n) AS n")).records[0]!.get(
			"n",
		).toNumber(),
		0,
	);
	await db.run(
		"CREATE(:User {id:'tutor'}),(:Student {id:'student'}),(:Student {id:'stranger'}),(:Admin {id:'staff',role:'admin'})",
	);
	const booking = async (id: string, issue = "late_join") => {
		const start = new Date(
			id === "normal" ? Date.parse("2026-10-31T10:00:00Z") : now - 30 * 60000,
		).toISOString();
		await db.run(
			`MATCH(s:Student {id:'student'}) CREATE(b:Booking {bookingId:$id,studentId:'student',tutorId:'tutor',status:'confirmed',
      slotDateTime:datetime($start),durationMinutes:25,paymentMethod:'trial'})-[:BOOKED_BY]->(s)
      CREATE(b)-[:BOOKS]->(:TimeSlot {slotId:$id,status:'booked'})`,
			{ id, start },
		);
		return (await service.create(
			id,
			"student",
			"tutor",
			"Student report details",
			issue,
		))!;
	};
	const first = await booking("normal");
	assert(first);
	assert.equal(
		await service.create(
			"normal",
			"student",
			"tutor",
			"Replacement",
			"no_show",
		),
		null,
	);
	assert.equal((await service.list(tutor)).length, 0);
	await service.reconcile();
	assert.equal((await service.list(tutor)).length, 0);
	now = Date.parse("2026-10-31T10:25:00Z");
	await service.reconcile();
	let c = (await service.list(tutor))[0];
	assert.equal(c.state, "awaiting_tutor");
	assert.equal(c.deadline, new Date(now + REPLY_WINDOW).toISOString());
	await assert.rejects(
		service.reply(c.id, { ...tutor, id: "stranger" }, "hi"),
		/not found/,
	);
	await service.reply(c.id, tutor, "hi", [], "up_to_ten", "connection");
	assert.equal((await service.list(admin))[0].state, "pending_ta301");
	await assert.rejects(service.reply(c.id, tutor, "second"), /already/);
	assert.equal((await service.list(student))[0].replies.length, 0);
	now += REPLY_WINDOW - 1;
	await service.reconcile();
	assert.equal((await service.list(admin))[0].state, "pending_ta301");
	now++;
	await service.reconcile();
	await service.reconcile();
	c = (await service.list(admin))[0];
	assert.equal(c.state, "ta301");
	assert.equal(c.nonresponse, false);
	assert.equal(
		(
			await db.run(
				"MATCH(p:Penalty {bookingId:'normal'}) WHERE p.revokedAt IS NULL RETURN count(p) AS n",
			)
		).records[0]!.get("n").toNumber(),
		1,
	);
	await new CancellationRefundService().reconcile(["normal"]);
	await new CancellationRefundService().reconcile(["normal"]);
	const b = (
		await db.run("MATCH(b:Booking {bookingId:'normal'}) RETURN b")
	).records[0]!.get("b").properties;
	assert.equal(b.refunded, true);
	assert.equal(b.trialRefunded, true);
	await assertTrialAllowance(db, "student", 1);
	await assert.rejects(
		service.reply(c.id, tutor, "late reply"),
		/already|deadline/,
	);
	await assert.rejects(
		service.followup(c.id, tutor, "reply to decision"),
		/not found/,
	);
	await service.followup(c.id, student, "Please reconsider the outcome.");
	assert.equal((await service.list(tutor))[0].replies.length, 1);
	await service.decide(
		c.id,
		"staff",
		"no_penalty",
		"Tutor compensation retained after review.",
		c.decisionRevision,
		false,
	);
	await assert.rejects(
		service.decide(c.id, "staff", "past", "stale", c.decisionRevision),
		/Decision changed/,
	);
	assert.equal(
		(await service.list(student))[0].decisionReason.includes(
			"compensation retained",
		),
		true,
	);
	const noReply = await booking("no-reply");
	await service.reconcile();
	now += REPLY_WINDOW;
	await assert.rejects(
		service.reply(noReply.id, tutor, "too late"),
		/deadline/,
	);
	await service.reconcile();
	const timeout = (await service.list(admin)).find((t) => t.id === noReply.id)!;
	assert.equal(timeout.nonresponse, true);
	const other = await booking("other");
	await service.reconcile();
	await service.reply(
		other.id,
		tutor,
		"The report is inaccurate",
		[],
		"up_to_ten",
		"other",
	);
	now += REPLY_WINDOW;
	await service.reconcile();
	assert.equal(
		(await service.list(admin)).find((t) => t.id === other.id)!.state,
		"awaiting_admin",
	);
	const long = await booking("long");
	await service.reconcile();
	await service.reply(
		long.id,
		tutor,
		"More than ten minutes were taught",
		[],
		"over_ten",
		"power",
	);
	now += REPLY_WINDOW;
	await service.reconcile();
	assert.equal(
		(await service.list(admin)).find((t) => t.id === long.id)!.state,
		"awaiting_admin",
	);
	const behavior = await booking("behavior", "inappropriate_behavior");
	await service.reconcile();
	assert.equal(
		(await service.list(tutor)).some((t) => t.id === behavior.id),
		false,
	);
	await service.requestExplanation(
		behavior.id,
		"staff",
		"Please explain the behavior described.",
	);
	await service.reply(
		behavior.id,
		tutor,
		"Explanation",
		[],
		"up_to_ten",
		"connection",
	);
	now += REPLY_WINDOW;
	await service.reconcile();
	assert.equal(
		(await service.list(admin)).find((t) => t.id === behavior.id)!.state,
		"awaiting_admin",
	);
	const extend = await booking("extend");
	await service.reconcile();
	await service.extend(
		extend.id,
		"staff",
		new Date(now + REPLY_WINDOW * 2).toISOString(),
		"Platform outage",
	);
	now += REPLY_WINDOW;
	await service.reconcile();
	assert.equal(
		(await service.list(admin)).find((t) => t.id === extend.id)!.state,
		"awaiting_tutor",
	);
	const noshow = await booking("noshow");
	await db.run(
		"MATCH(b:Booking {bookingId:'noshow'}) SET b.attendanceSource='automatic_room_no_show',b.penaltyCode='301'",
	);
	await service.reconcile();
	const closed = (await service.list(admin)).find((t) => t.id === noshow.id)!;
	assert.equal(closed.state, "ta301");
	assert.equal(closed.requestedAt, undefined);
	assert.equal(closed.nonresponse, false);
	// Real HTTP permissions, independent of hidden UI controls.
	const app = new Elysia({ prefix: "/inbox" }).use(Routes);
	const token = await signAuthToken({
		userId: "student",
		email: "synthetic@example.test",
		role: "student",
	});
	const get = await app.handle(
		new Request("http://localhost/inbox/disputes/?as=student", {
			headers: { cookie: "studentAuth=" + token },
		}),
	);
	assert.equal(get.status, 200);
	const data: any = await get.json();
	assert.equal(
		data.data.some((t: any) => t.replies.some((r: any) => r.role === "tutor")),
		false,
	);
	const denied = await app.handle(
		new Request(
			"http://localhost/inbox/disputes/" +
				first.id +
				"/images/unknown?as=student",
			{ headers: { cookie: "studentAuth=" + token } },
		),
	);
	assert.equal(denied.status, 404);
	const tutorToken = await signAuthToken({
		userId: "tutor",
		email: "synthetic@example.test",
		role: "tutor",
	});
	const forbidden = await app.handle(
		new Request(
			"http://localhost/inbox/disputes/" + first.id + "/followup?as=tutor",
			{
				method: "POST",
				headers: {
					cookie: "tutorAuth=" + tutorToken,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ text: "decision reply" }),
			},
		),
	);
	assert.equal(forbidden.status, 403);
	const imageOnly = await booking("image-only");
	await service.reconcile();
	await service.reply(imageOnly.id, tutor, "", [{ id: "synthetic-image", sha256: "a".repeat(64) }]);
	assert.equal(
		(await service.list(admin)).find((t) => t.id === imageOnly.id)!.state,
		"awaiting_admin",
	);
	const empty = await booking("empty");
	await service.reconcile();
	await assert.rejects(service.reply(empty.id, tutor, ""), /Write a reply/);
	await service.decide(
		empty.id,
		"staff",
		"no_penalty",
		"Platform issue compensated using approved tutor rate.",
		0,
		true,
		true,
	);
	assert.equal(
		(
			await db.run(
				"MATCH(b:Booking {bookingId:'empty'}) RETURN b.penaltyCode AS code",
			)
		).records[0]!.get("code"),
		"501",
	);
	// Verify an actual consumed mock ticket is restored once through the existing processor.
	process.env.ALLOW_MOCK_TICKET_PURCHASES = "true";
	now = Date.now();
	const paid = await booking("paid-refund");
	await service.reconcile();
	const wallet = "0x0000000000000000000000000000000000000001";
	await db.run(
		`MATCH(b:Booking {bookingId:'paid-refund'}),(s:Student {id:'student'}) SET b.paymentMethod='erc1155',s.externalWalletAddress=$wallet
    CREATE(:MockTicketBalance {walletAddress:$wallet,basic:0,premium:0,trial:0})
    CREATE(:MockTicketTransfer {transactionHash:'mock-ticket-dispute',bookingId:'paid-refund',studentId:'student',walletAddress:$wallet,status:'used',tier:'basic',quantity:1})
    CREATE(:TicketTransaction {id:'original-paid',bookingId:'paid-refund',studentId:'student',studentWallet:$wallet,type:'booking',status:'completed',tier:'basic',tokenId:'1',quantity:1,transferTxId:'mock-ticket-dispute'})`,
		{ wallet },
	);
	await service.decide(
		paid.id,
		"staff",
		"ta301",
		"Student report accepted after review.",
		0,
	);
	const refunds = new CancellationRefundService();
	await refunds.process("paid-refund");
	await refunds.process("paid-refund");
	assert.equal(
		(
			await db.run(
				"MATCH(b:MockTicketBalance {walletAddress:$wallet}) RETURN b.basic AS n",
				{ wallet },
			)
		).records[0]!.get("n").toNumber(),
		1,
	);
	assert.equal(
		(
			await db.run(
				"MATCH(r:TicketTransaction {bookingId:'paid-refund',type:'cancellation'}) RETURN count(r) AS n",
			)
		).records[0]!.get("n").toNumber(),
		1,
	);
	console.log(
		"Student dispute persistence, deadline, refund, routing and HTTP privacy tests passed",
	);
	const concurrent = await booking("concurrent-replies");
	await service.reconcile();
	const replies = await Promise.allSettled([
		service.reply(concurrent.id, tutor, "First explanation"),
		service.reply(concurrent.id, tutor, "Second explanation"),
	]);
	assert.equal(replies.filter((r) => r.status === "fulfilled").length, 1);
	assert.equal(
		(await service.list(admin)).find((t) => t.id === concurrent.id)!.replies
			.length,
		1,
	);
	const race = await booking("deadline-race");
	await service.reconcile();
	now += REPLY_WINDOW;
	await Promise.all([service.reconcile(), service.reconcile()]);
	assert.equal(
		(
			await db.run(
				"MATCH(p:Penalty {bookingId:'deadline-race'}) WHERE p.revokedAt IS NULL RETURN count(p) AS n",
			)
		).records[0]!.get("n").toNumber(),
		1,
	);
	console.log("Concurrent reply and deadline-worker tests passed");
	now = Date.now();
	const httpCase = await booking("http-origin");
	await service.reconcile();
	const post = (
		id: string,
		path: string,
		token: string,
		role: string,
		origin: string,
		body: any,
	) =>
		app.handle(
			new Request(`http://localhost/inbox/disputes/${id}/${path}?as=${role}`, {
				method: "POST",
				headers: {
					cookie: `${role}Auth=${token}`,
					"Content-Type": "application/json",
					origin,
				},
				body: JSON.stringify(body),
			}),
		);
	assert.equal(
		(
			await post(
				httpCase.id,
				"reply",
				tutorToken,
				"tutor",
				"https://evil.example",
				{ text: "hi" },
			)
		).status,
		403,
	);
	assert.equal(
		(
			await post(
				httpCase.id,
				"reply",
				tutorToken,
				"tutor",
				"https://tutor.fluentxverse.com",
				{ text: "hi" },
			)
		).status,
		200,
	);
	assert.equal(
		(
			await post(
				first.id,
				"followup",
				token,
				"student",
				"https://student.fluentxverse.com",
				{ text: "Follow-up for staff" },
			)
		).status,
		200,
	);
	console.log("Real student/tutor origin enforcement passed");
	const blocked = await booking("blocked-live");
	await service.reconcile();
	await db.run(
		`MATCH(b:Booking {bookingId:'blocked-live'}) SET b.paymentMethod='erc1155'
    CREATE(:TicketTransaction {id:'blocked-original',bookingId:'blocked-live',studentId:'student',studentWallet:$wallet,type:'booking',status:'completed',tier:'basic',tokenId:'1',quantity:1,transferTxId:'synthetic-non-mock'})`,
		{ wallet },
	);
	await service.decide(
		blocked.id,
		"staff",
		"ta301",
		"Synthetic staging transfer guard test",
		0,
	);
	process.env.REFUND_TRANSFERS_DISABLED = "true";
	let engineUsed = false;
	const engine = {
		configured() {
			engineUsed = true;
			throw Error("Live engine must not be called");
		},
	};
	await new CancellationRefundService(engine as any).process("blocked-live");
	assert.equal(engineUsed, false);
	console.log("Live refund transfer guard passed");
	const events = await disputeEvents(0);
	assert(events.length > 10);
	assert(events.every((e, i) => e.sequence === i + 1 && e.policyHash === DISPUTE_POLICY_HASH));
	assert.equal(events.filter(e => e.kind === "refund" && e.caseKey === events[0].caseKey).length, 1);
	assert.equal(JSON.stringify(events).includes("Student report details"), false);
	assert.equal(JSON.stringify(events).includes(wallet), false);
	for (const role of [student, tutor, admin]) {
		assert.equal(JSON.stringify(await service.list(role)).includes("chainSalt"), false);
	}
	const before = Number((await db.run("MATCH(c:DisputeChainCounter {id:'v1'}) RETURN c.sequence AS n")).records[0]!.get("n"));
	await assert.rejects(db.executeWrite(async tx => {
		const thread = (await tx.run("MATCH(t:LessonIssueThread {id:$id}) RETURN t", {id:first.id})).records[0]!.get("t").properties;
		await appendDisputeEvent(tx, thread, "refund", new Date(now).toISOString(), {}, {receipt:"rolled-back"});
		throw Error("force rollback");
	}), /force rollback/);
	assert.equal(Number((await db.run("MATCH(c:DisputeChainCounter {id:'v1'}) RETURN c.sequence AS n")).records[0]!.get("n")), before);
	const feed = new Elysia().use(disputeChainRoute);
	assert.equal((await feed.handle(new Request("http://localhost/internal/dispute-chain/events"))).status, 404);
	const fetched = await feed.handle(new Request("http://localhost/internal/dispute-chain/events?after=0", {headers:{"X-FXV-Dispute-Feed-Key":process.env.DISPUTE_CHAIN_FEED_KEY}}));
	assert.equal(fetched.status, 200);
	assert.deepEqual(((await fetched.json()) as {events: unknown[]}).events, events);
	if (process.env.DISPUTE_CHAIN_FIXTURE_OUTPUT) {
		if (process.env.DISPUTE_CHAIN_FIXTURE_OUTPUT !== "/tmp/fxv-dispute-case-events.json") throw Error("Only disposable fixture output is allowed");
		await Bun.write(process.env.DISPUTE_CHAIN_FIXTURE_OUTPUT, JSON.stringify(events.filter(e => e.caseKey === events[0].caseKey)));
	}
	console.log(`Atomic chain outbox, rollback, refund deduplication, private projections and authenticated feed passed (${events.length} events)`);
} finally {
	await db.close();
	await closeDriver();
}
