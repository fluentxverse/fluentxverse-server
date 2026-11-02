import type { ManagedTransaction } from "neo4j-driver";
import { getDriver } from "../db/memgraph";
import { lessonReportingWindow } from "../utils/lessonReportingWindow";
import {
	validateStudentTutorIssue,
	studentTutorIssueLabel,
} from "../utils/studentTutorIssues";
import { reconcileTutorPenaltyBlock } from "./schedule.services/tutorPenaltyBlock";
import { appendDisputeEvent, enrollDispute, ensureDisputeOutbox } from "./disputeChain/outbox";
import {
	disputeReplyState,
	disputeText,
	disputeTime,
	lessonDescription,
	REPLY_WINDOW,
	terminalDisputeStates,
} from "./studentDispute.policy";

export type DisputeActor = { id: string; role: "admin" | "tutor" | "student" };
let schema: Promise<void> | undefined;
const runtimeStartedAt = new Date().toISOString();
async function ensureSchema() {
	return (schema ||= (async () => {
		const s = getDriver().session();
		try {
			for (const statement of [
				"CREATE CONSTRAINT ON (n:LessonIssueThread) ASSERT n.bookingId IS UNIQUE",
				"CREATE CONSTRAINT ON (n:DisputePolicyActivation) ASSERT n.id IS UNIQUE",
				"CREATE INDEX ON :LessonIssueThread(state)",
				"CREATE INDEX ON :LessonIssueThread(deadline)",
			]) {
				try {
					await s.run(statement);
				} catch (e) {
					if (!/already exists|already exist/i.test(String(e))) throw e;
				}
			}
			await s.run(
				`MERGE(p:DisputePolicyActivation {id:'student-disputes-v1'}) ON CREATE SET p.activatedAt=$now`,
				{ now: runtimeStartedAt },
			);
		} finally {
			await s.close();
		}
	})().catch((e) => {
		schema = undefined;
		throw e;
	}));
}
async function notice(
	tx: ManagedTransaction,
	t: any,
	role: "student" | "tutor",
	key: string,
	message: string,
	now: string,
) {
	await tx.run(
		`MERGE(n:Notification {id:$id}) ON CREATE SET n.userId=$user,n.userType=$role,n.type='system',
    n.title='Lesson issue',n.message=$message,n.timestamp=$now,n.isRead=false,n.data=$data`,
		{
			id: `report:dispute:${t.id}:${key}:${role}`,
			user: role === "student" ? t.studentId : t.tutorId,
			role,
			message,
			now,
			data: JSON.stringify({ bookingId: t.bookingId, link: "/inbox" }),
		},
	);
}
async function staff(tx: ManagedTransaction, id: string) {
	const r = await tx.run(
		"MATCH(a:Admin {id:$id}) WHERE a.role IN ['admin','superadmin'] RETURN a",
		{ id },
	);
	if (!r.records.length) throw Error("Staff access required");
}
async function locked(tx: ManagedTransaction, id: string) {
	const r = await tx.run(
		"MATCH(t:LessonIssueThread {id:$id,origin:'student'}) SET t.writeRevision=coalesce(t.writeRevision,0)+1 RETURN t",
		{ id },
	);
	const t = r.records[0]?.get("t").properties;
	if (!t) throw Error("Conversation not found");
	return t;
}
async function refundIntent(
	tx: ManagedTransaction,
	bookingId: string,
	actor: string,
	reason: string,
	now: string,
) {
	await tx.run(
		`MATCH(b:Booking {bookingId:$bookingId}) SET b.refundApprovedBy=$actor,b.refundApprovalReason=$reason,
    b.refundApprovedAt=$now,b.cancellationRefundVersion=1,
    b.refundStatus=CASE WHEN coalesce(b.refunded,false) THEN 'completed' WHEN b.refundStatus='review' THEN 'review' ELSE 'pending' END`,
		{ bookingId, actor, reason, now },
	);
}

export class StudentDisputeService {
	constructor(private readonly clock = () => Date.now()) {}
	async get(bookingId: string, studentId: string) {
		const s = getDriver().session();
		try {
			const r = await s.run(
				"MATCH(t:LessonIssueThread {bookingId:$bookingId,studentId:$studentId,origin:'student'}) RETURN t",
				{ bookingId, studentId },
			);
			const t = r.records[0]?.get("t").properties;
			return t
				? {
						id: t.id,
						reason: t.reason,
						tutorIssue: t.tutorIssue || null,
						tutorIssueLabel: studentTutorIssueLabel(t.tutorIssue),
						details: t.details,
						createdAt: t.createdAt,
						status: terminalDisputeStates.includes(t.state)
							? "resolved"
							: "under_review",
						resolution: t.studentDecision || null,
						attendanceCorrection: null,
						ticketTransactionId: null,
					}
				: null;
		} finally {
			await s.close();
		}
	}
	async create(
		bookingId: string,
		studentId: string,
		reason: string,
		details: string,
		tutorIssue?: string,
	) {
		await ensureSchema();
		await ensureDisputeOutbox();
		const s = getDriver().session();
		try {
			return await s.executeWrite(async (tx) => {
				const r = await tx.run(
					`MATCH(b:Booking {bookingId:$bookingId})-[:BOOKED_BY]->(u:Student {id:$studentId})
        SET b.compensationWriteRevision=coalesce(b.compensationWriteRevision,0)+1 RETURN b`,
					{ bookingId, studentId },
				);
				const b = r.records[0]?.get("b").properties;
				if (!b) throw Error("Lesson not found");
				const nowMs = this.clock(),
					now = new Date(nowMs).toISOString();
				const startsAt = disputeTime(b.slotDateTime),
					minutes = Number(b.durationMinutes || 25);
				const w = lessonReportingWindow(startsAt, minutes, b.status, nowMs),
					endsAt = w.endsAt;
				if (w.reason || nowMs < Date.parse(startsAt) + 120000)
					throw Error("Reporting is not available for this lesson");
				validateStudentTutorIssue(
					reason,
					tutorIssue,
					details,
					nowMs < Date.parse(endsAt),
				);
				const existing = await tx.run(
					"MATCH(t:LessonIssueThread {bookingId:$bookingId}) RETURN t",
					{ bookingId },
				);
				if (
					existing.records.some(
						(row) => row.get("t").properties.origin === "student",
					)
				)
					return null;
				if (existing.records.length)
					await tx.run(
						`MATCH(t:LessonIssueThread {bookingId:$bookingId})
        WHERE t.origin IS NULL SET t:LegacyLessonIssueThread,t.archivedReason='Superseded by student dispute',t.archivedAt=$now REMOVE t:LessonIssueThread`,
						{ bookingId, now },
					);
				// A payout reservation and a dispute must serialize on the same booking.
				const reserved = await tx.run(
					`MATCH(e:TutorEarning {bookingId:$bookingId}) WHERE e.status='reserved' OR e.payoutBatchId IS NOT NULL RETURN e`,
					{ bookingId },
				);
				if (reserved.records.length)
					throw Error(
						"Lesson already has a financial reservation; contact support",
					);
				const t = {
					...enrollDispute(),
					id: crypto.randomUUID(),
					bookingId,
					tutorId: b.tutorId,
					studentId,
					origin: "student",
					state:
						tutorIssue === "inappropriate_behavior"
							? "staff_initial"
							: "queued",
					startsAt,
					endsAt,
					createdAt: now,
					reason,
					tutorIssue: tutorIssue || "",
					details,
					body: `Student report: ${studentTutorIssueLabel(tutorIssue) || reason}\n${details}\n\nLesson: ${lessonDescription(startsAt, endsAt)}`,
				};
				await tx.run(
					`MATCH(b:Booking {bookingId:$bookingId}) CREATE(t:LessonIssueThread) SET t=$thread
        CREATE(b)-[:HAS_ISSUE_THREAD]->(t) SET b.disputeHold=true`,
					{ bookingId, thread: t },
				);
				await appendDisputeEvent(tx, t, "open", now, {
					staffFirst: tutorIssue === "inappropriate_behavior",
					endedAt: Math.floor(Date.parse(endsAt) / 1000),
				}, { reason, tutorIssue, details });
				await notice(
					tx,
					t,
					"student",
					"received",
					"We received your lesson report. Staff will investigate and send the outcome to your inbox.",
					now,
				);
				return {
					id: t.id,
					reason,
					details,
					tutorIssue: tutorIssue || null,
					tutorIssueLabel: studentTutorIssueLabel(tutorIssue),
					createdAt: now,
					status: "under_review",
				};
			});
		} finally {
			await s.close();
		}
	}
	async owns(id: string) {
		const s = getDriver().session();
		try {
			return (
				(
					await s.run(
						"MATCH(t:LessonIssueThread {id:$id,origin:'student'}) RETURN t",
						{ id },
					)
				).records.length > 0
			);
		} finally {
			await s.close();
		}
	}
	async list(actor: DisputeActor) {
		const s = getDriver().session();
		try {
			const rows = await s.run(
				`MATCH(t:LessonIssueThread {origin:'student'}) WHERE $admin OR
        ($role='student' AND t.studentId=$actor) OR ($role='tutor' AND t.tutorId=$actor AND (t.requestedAt IS NOT NULL OR t.tutorDecision IS NOT NULL))
        MATCH(b:Booking {bookingId:t.bookingId}) RETURN t,b.refundStatus AS refundStatus ORDER BY t.createdAt DESC LIMIT 100`,
				{ admin: actor.role === "admin", role: actor.role, actor: actor.id },
			);
			const out: any[] = [];
			for (const r of rows.records) {
				const t = r.get("t").properties;
				const { chainSalt: _privateChainSalt, ...adminVisible } = t;
				const messages = await s.run(
					`MATCH(t:LessonIssueThread {id:$id})-[:HAS_REPLY]->(r:LessonIssueReply)
          WHERE $admin OR ($role='tutor' AND r.role='tutor') OR ($role='student' AND r.audience='student')
          RETURN r ORDER BY r.createdAt LIMIT 100`,
					{ id: t.id, admin: actor.role === "admin", role: actor.role },
				);
				const replies = messages.records.map((row) => {
					const p = row.get("r").properties;
					return { ...p, attachments: JSON.parse(p.attachmentsJson || "[]") };
				});
				const canReply =
					actor.role === "tutor" &&
					t.state === "awaiting_tutor" &&
					!t.firstTutorReplyAt &&
					this.clock() < Date.parse(t.deadline);
				// Explicit participant projection prevents private evidence/staff notes from leaking.
				const visible =
					actor.role === "admin"
						? adminVisible
						: {
								id: t.id,
								bookingId: t.bookingId,
								startsAt: t.startsAt,
								endsAt: t.endsAt,
								origin: t.origin,
								createdAt: t.createdAt,
								state: t.state,
								deadline: t.deadline,
								body: actor.role === "student" ? t.details : t.body,
								decisionReason:
									actor.role === "student"
										? t.studentDecision
										: t.tutorDecision,
								behavior: t.tutorIssue === "inappropriate_behavior",
								nonresponse:
									actor.role === "tutor" ? !!t.nonresponse : undefined,
							};
				out.push({
					...visible,
					replies,
					canReply,
					refundStatus: r.get("refundStatus"),
					canFollowup: actor.role === "student" && !!t.studentDecision,
					serverNow: new Date(this.clock()).toISOString(),
					decisionRevision: Number(t.decisionRevision || 0),
				});
			}
			return out;
		} finally {
			await s.close();
		}
	}
	async reply(
		id: string,
		actor: DisputeActor,
		text: unknown,
		attachments: { id: string; sha256?: string }[] = [],
		duration?: string,
		reason?: string,
	) {
		const body = disputeText(text, attachments.length),
			state = disputeReplyState(duration, reason),
			s = getDriver().session();
		try {
			await s.executeWrite(async (tx) => {
				const t = await locked(tx, id);
				if (actor.role !== "tutor" || t.tutorId !== actor.id)
					throw Error("Conversation not found");
				if (t.firstTutorReplyAt)
					throw Error(
						"A reply has already been sent. Contact support for reconsideration.",
					);
				const acceptedMs = this.clock();
				if (Number(t.chainVersion) === 1 && attachments.some(a => !/^[a-f0-9]{64}$/.test(a.sha256 || "")))
					throw Error("Invalid image evidence digest");
				if (
					t.state !== "awaiting_tutor" ||
					!t.deadline ||
					acceptedMs >= Date.parse(t.deadline)
				)
					throw Error(
						"The 24-hour reply deadline has passed or this case is closed. Contact support.",
					);
				const now = new Date(acceptedMs).toISOString();
				await tx.run(
					`MATCH(t:LessonIssueThread {id:$id}) CREATE(r:LessonIssueReply {id:$rid,role:'tutor',actorId:$actor,
        body:$body,createdAt:$now,attachmentsJson:$attachments,duration:$duration,reason:$reason})
        CREATE(t)-[:HAS_REPLY]->(r) SET t.firstTutorReplyAt=$now,t.responseDuration=$duration,t.responseReason=$reason,t.state=$state`,
					{
						id,
						rid: crypto.randomUUID(),
						actor: actor.id,
						body,
						now,
						attachments: JSON.stringify(attachments),
						duration: duration || "",
						reason: reason || "",
						state:
							t.tutorIssue === "inappropriate_behavior"
								? "awaiting_admin"
								: state,
					},
				);
				await appendDisputeEvent(tx, t, "response", now, {
					automaticTA301: t.tutorIssue !== "inappropriate_behavior" && state === "pending_ta301",
				}, { body, attachments, duration, reason, actorId: actor.id });
			});
		} finally {
			await s.close();
		}
	}
	async requestExplanation(id: string, actorId: string, reason: string) {
		if (!reason.trim()) throw Error("An explanation request is required");
		const s = getDriver().session();
		try {
			await s.executeWrite(async (tx) => {
				await staff(tx, actorId);
				const t = await locked(tx, id);
				if (t.state !== "staff_initial" || t.requestedAt)
					throw Error(
						"An explanation has already been requested or this case is closed",
					);
				await appendDisputeEvent(tx, t, "authorize", new Date(this.clock()).toISOString(), {}, { actorId, reason });
				await this.request(tx, t, reason);
			});
		} finally {
			await s.close();
		}
	}
	private async request(tx: ManagedTransaction, t: any, extra = "") {
		const requestMs = Number(t.chainVersion) === 1 ? Math.floor(this.clock() / 1000) * 1000 : this.clock();
		if (requestMs < Date.parse(t.endsAt)) return;
		const now = new Date(requestMs).toISOString(),
			deadline = new Date(requestMs + REPLY_WINDOW).toISOString();
		const routing =
			t.tutorIssue === "inappropriate_behavior"
				? "Staff will review your explanation; teaching duration does not decide this complaint."
				: "10 minutes or less with a listed tutor-side cause results in TA-301 at this deadline. Other and more than 10 minutes go to staff review.";
		const body = `${t.body}\n\n${extra}\nSend your one complete reply with any supporting images. Your reply is private to staff. Deadline: ${deadline}. No reply within 24 hours results in TA-301. ${routing} Reconsideration requires a support ticket.`;
		await tx.run(
			"MATCH(t:LessonIssueThread {id:$id}) SET t.state='awaiting_tutor',t.requestedAt=$now,t.deadline=$deadline,t.body=$body",
			{ id: t.id, now, deadline, body },
		);
		await notice(tx, t, "tutor", "explain", body, now);
		await appendDisputeEvent(tx, t, "request", now, {
			endedAt: Math.floor(Date.parse(t.endsAt) / 1000), requestedAt: Math.floor(requestMs / 1000),
		}, { extra });
	}
	async extend(id: string, actorId: string, deadline: string, reason: string) {
		if (
			!Number.isFinite(Date.parse(deadline)) ||
			Date.parse(deadline) <= this.clock() ||
			!reason.trim()
		)
			throw Error("Choose a future deadline and provide a reason");
		const s = getDriver().session();
		try {
			await s.executeWrite(async (tx) => {
				await staff(tx, actorId);
				const t = await locked(tx, id);
				if (Number(t.chainVersion) === 1) deadline = new Date(Math.floor(Date.parse(deadline) / 1000) * 1000).toISOString();
				if (
					!["awaiting_tutor", "pending_ta301"].includes(t.state) ||
					Date.parse(deadline) <= this.clock() ||
					Date.parse(deadline) <= Date.parse(t.deadline)
				)
					throw Error("Only a pending deadline can be extended");
				await tx.run(
					`MATCH(t:LessonIssueThread {id:$id}) SET t.deadline=$deadline
        CREATE(a:LessonIssueDeadlineExtension {id:$aid,actorId:$actorId,reason:$reason,previousDeadline:$previous,deadline:$deadline,createdAt:$now})
        CREATE(t)-[:HAS_EXTENSION]->(a)`,
					{
						id,
						deadline: new Date(deadline).toISOString(),
						aid: crypto.randomUUID(),
						actorId,
						reason,
						previous: t.deadline,
						now: new Date(this.clock()).toISOString(),
					},
				);
				await notice(
					tx,
					t,
					"tutor",
					"extension:" + crypto.randomUUID(),
					`Response deadline extended to ${deadline}. ${reason}`,
					new Date(this.clock()).toISOString(),
				);
				await appendDisputeEvent(tx, t, "extend", new Date(this.clock()).toISOString(), {
					deadline: Math.floor(Date.parse(deadline) / 1000),
				}, { actorId, reason });
			});
		} finally {
			await s.close();
		}
	}
	async decide(
		id: string,
		actorId: string,
		decision: string,
		reason: string,
		revision: number,
		refund = false,
		sys501 = false,
	) {
		if (!["ta301", "no_penalty", "past"].includes(decision) || !reason.trim())
			throw Error("Choose an outcome and provide its reason");
		const s = getDriver().session();
		try {
			await s.executeWrite(async (tx) => {
				await staff(tx, actorId);
				const t = await locked(tx, id);
				if (Number(t.decisionRevision || 0) !== revision)
					throw Error("Decision changed. Refresh before deciding again.");
				await this.resolve(tx, t, decision, reason, actorId, refund);
				if (sys501) {
					if (decision !== "no_penalty")
						throw Error("Choose No penalty for SYS-501 compensation");
					await tx.run(
						`MATCH(b:Booking {bookingId:$bookingId}) SET b.penaltyCode='501',b.penaltyReason=$reason,b.systemCompensationApprovedBy=$actor,
          b.systemCompensationApprovedAt=$now`,
						{
							bookingId: t.bookingId,
							reason,
							actor: actorId,
							now: new Date(this.clock()).toISOString(),
						},
					);
				}
			});
		} finally {
			await s.close();
		}
	}
	private async resolve(
		tx: ManagedTransaction,
		t: any,
		decision: string,
		reason: string,
		actor: string,
		refund: boolean,
		nonresponse = false,
		noShow = false,
	) {
		const now = new Date(this.clock()).toISOString();
		const r = await tx.run(
			"MATCH(b:Booking {bookingId:$bookingId}) SET b.compensationWriteRevision=coalesce(b.compensationWriteRevision,0)+1 RETURN b",
			{ bookingId: t.bookingId },
		);
		const b = r.records[0]?.get("b").properties;
		if (!b) throw Error("Lesson not found");
		if (b.status === "cancelled" && decision === "ta301")
			throw Error("Cancelled lessons cannot receive this penalty");
		await tx.run(
			`MATCH(p:Penalty {bookingId:$bookingId}) WHERE p.penaltyCode='301' AND p.revokedAt IS NULL AND coalesce(p.status,'')<>'voided'
      SET p.status='voided',p.revokedAt=$now,p.revocationReason=$reason`,
			{ bookingId: t.bookingId, now, reason },
		);
		await tx.run(
			`MATCH(b:Booking {bookingId:$bookingId}) SET b.issueDecision=$decision,b.issueDecisionBy=$actor,b.issueDecisionAt=$now,
      b.disputeHold=false REMOVE b.penaltyCode,b.penaltyReason,b.penaltyTimestamp`,
			{ bookingId: t.bookingId, decision, actor, now },
		);
		if (decision === "ta301")
			await tx.run(
				`MATCH(b:Booking {bookingId:$bookingId}),(u:User {id:$tutorId})
      CREATE(p:Penalty {penaltyId:$pid,bookingId:$bookingId,tutorId:$tutorId,penaltyCode:'301',status:'active',penaltyReason:$reason,
        severity:'critical',affectsCompensation:true,createdAt:datetime($now),source:$source}) CREATE(u)-[:HAS_PENALTY]->(p)
      SET b.penaltyCode='301',b.penaltyReason=$reason,b.penaltyTimestamp=datetime($now)`,
				{
					bookingId: t.bookingId,
					tutorId: t.tutorId,
					pid: crypto.randomUUID(),
					reason,
					now,
					source: nonresponse
						? "issue_reply_timeout"
						: actor === "system"
							? "issue_duration"
							: "issue_staff_decision",
				},
			);
		await tx.run(
			`MATCH(b:Booking {bookingId:$bookingId})-[:BOOKS]->(slot:TimeSlot)
      SET slot.status=CASE WHEN $past THEN 'past' ELSE 'booked' END,slot.issueRemoved=$past`,
			{ bookingId: t.bookingId, past: decision === "past" },
		);
		if (decision === "ta301" || refund)
			await refundIntent(tx, t.bookingId, actor, reason, now);
		const revision = Number(t.decisionRevision || 0) + 1;
		const studentDecision = `Your lesson report was resolved. ${decision === "ta301" || refund ? "Your lesson ticket refund has been requested." : "Staff reviewed the lesson."} ${actor === "system" ? "Please contact staff with any questions." : reason}`;
		await tx.run(
			`MATCH(t:LessonIssueThread {id:$id}) SET t.state=$decision,t.decisionRevision=$revision,t.decisionReason=$reason,
      t.studentDecision=$studentDecision,t.tutorDecision=$tutorDecision,t.decidedAt=$now,t.decidedBy=$actor,t.nonresponse=$nonresponse
      CREATE(a:LessonIssueDecision {id:$aid,actorId:$actor,decision:$decision,reason:$reason,createdAt:$now,nonresponse:$nonresponse})
      CREATE(t)-[:HAS_DECISION]->(a)`,
			{
				id: t.id,
				revision,
				decision,
				reason,
				studentDecision,
				tutorDecision: `${nonresponse ? "TA-301 - No tutor reply within 24 hours" : decision}: ${reason}`,
				now,
				actor,
				nonresponse,
				aid: crypto.randomUUID(),
			},
		);
		await notice(
			tx,
			t,
			"student",
			"decision:" + revision,
			studentDecision,
			now,
		);
		await notice(
			tx,
			t,
			"tutor",
			"decision:" + revision,
			`${decision}: ${reason}`,
			now,
		);
		await reconcileTutorPenaltyBlock(tx, t.tutorId, true);
		await appendDisputeEvent(tx, t, actor !== "system" ? "staff" : noShow ? "noshow" : nonresponse ? "nonresponse" : "duration", now, {
			outcome: decision === "ta301" ? 1 : decision === "no_penalty" ? 2 : 3,
			refund: decision === "ta301" || refund || !!b.refundApprovedBy,
			endedAt: Math.floor(Date.parse(t.endsAt) / 1000),
			excuseNonResponse: false,
		}, { actor, reason, decisionRevision: revision, nonresponse, noShow });
	}
	async followup(id: string, actor: DisputeActor, text: string) {
		const body = disputeText(text),
			s = getDriver().session();
		try {
			await s.executeWrite(async (tx) => {
				const t = await locked(tx, id);
				if (actor.role === "admin") await staff(tx, actor.id);
				else if (
					actor.role !== "student" ||
					t.studentId !== actor.id ||
					!t.studentDecision
				)
					throw Error("Conversation not found");
				await tx.run(
					`MATCH(t:LessonIssueThread {id:$id}) CREATE(r:LessonIssueReply {id:$rid,role:$role,actorId:$actor,body:$body,
        audience:'student',createdAt:$now}) CREATE(t)-[:HAS_REPLY]->(r)`,
					{
						id,
						rid: crypto.randomUUID(),
						role: actor.role,
						actor: actor.id,
						body,
						now: new Date(this.clock()).toISOString(),
					},
				);
				// Follow-ups deliberately do not change the decision, deadline or financial state.
				if (actor.role === "admin")
					await notice(
						tx,
						t,
						"student",
						"followup:" + crypto.randomUUID(),
						body,
						new Date(this.clock()).toISOString(),
					);
			});
		} finally {
			await s.close();
		}
	}
	async reconcile() {
		await ensureSchema();
		const s = getDriver().session();
		try {
			const rows = await s.run(
				`MATCH(t:LessonIssueThread {origin:'student'}) MATCH(b:Booking {bookingId:t.bookingId})
        WHERE (t.state='queued' AND t.endsAt <= $now) OR
        (t.state IN ['awaiting_tutor','pending_ta301'] AND t.deadline <= $now) OR
        (t.state IN ['queued','staff_initial','awaiting_tutor','pending_ta301','awaiting_admin'] AND (b.status='cancelled' OR b.attendanceSource='automatic_room_no_show' AND b.penaltyCode='301'))
        RETURN t.id AS id ORDER BY t.createdAt LIMIT 200`,
				{ now: new Date(this.clock()).toISOString() },
			);
			for (const row of rows.records) {
				try {
					await s.executeWrite(async (tx) => {
						const t = await locked(tx, row.get("id"));
						const b = (
							await tx.run("MATCH(b:Booking {bookingId:$bookingId}) RETURN b", {
								bookingId: t.bookingId,
							})
						).records[0]?.get("b").properties;
						if (!b) return;
						if (b.status === "cancelled") {
							await tx.run(
								"MATCH(t:LessonIssueThread {id:$id}),(b:Booking {bookingId:$bookingId}) SET t.state='cancelled',b.disputeHold=false",
								{ id: t.id, bookingId: t.bookingId },
							);
							await appendDisputeEvent(tx, t, "cancel", new Date(this.clock()).toISOString(), { outcome: 3, refund: !!b.refundApprovedBy }, { status: "cancelled" });
							return;
						}
						if (
							b.attendanceSource === "automatic_room_no_show" &&
							b.penaltyCode === "301"
						) {
							await this.resolve(
								tx,
								t,
								"ta301",
								"Tutor did not enter during the scheduled lesson. Case closed automatically; no tutor reply required.",
								"system",
								true,
								false,
								true,
							);
							return;
						}
						if (t.state === "queued" && this.clock() >= Date.parse(t.endsAt))
							await this.request(tx, t);
						else if (
							["awaiting_tutor", "pending_ta301"].includes(t.state) &&
							this.clock() >= Date.parse(t.deadline)
						) {
							const noReply = !t.firstTutorReplyAt;
							if (noReply || t.state === "pending_ta301")
								await this.resolve(
									tx,
									t,
									"ta301",
									noReply
										? "No tutor reply within 24 hours."
										: "Tutor reported 10 minutes or less with a tutor-side issue.",
									"system",
									true,
									noReply,
								);
						}
					});
				} catch (e) {
					console.error(
						"Student dispute reconciliation will retry",
						row.get("id"),
						e instanceof Error ? e.message : "failed",
					);
				}
			}
			// Automatic full-lesson no-shows refund even when no student report exists.
			await s.run(`MATCH(p:DisputePolicyActivation {id:'student-disputes-v1'}),(b:Booking)
        WHERE b.penaltyCode='301' AND b.refundApprovedBy IS NULL AND b.penaltyTimestamp >= datetime(p.activatedAt)
        SET b.refundApprovedBy='system',b.refundApprovalReason='TA-301 lesson refund',b.cancellationRefundVersion=1,
          b.refundStatus=CASE WHEN coalesce(b.refunded,false) THEN 'completed' WHEN b.refundStatus='review' THEN 'review' ELSE 'pending' END`);
			const backlog = await s.run(
				`MATCH(t:LessonIssueThread {origin:'student'}) WHERE t.state IN ['awaiting_tutor','pending_ta301']
        AND t.deadline < $late RETURN count(t) AS n`,
				{ late: new Date(this.clock() - 300000).toISOString() },
			);
			if (Number(backlog.records[0]?.get("n")) > 0)
				await s.run(
					`MERGE(n:Notification {id:'report:dispute-deadline-backlog'})
        SET n.userId='admin',n.userType='admin',n.type='system',n.title='Dispute deadline processing delayed',
          n.message='Some dispute deadlines are more than five minutes overdue. Check the API worker and database.',n.timestamp=$now,n.isRead=false`,
					{ now: new Date(this.clock()).toISOString() },
				);
		} finally {
			await s.close();
		}
	}
}
export const studentDisputeService = new StudentDisputeService();
