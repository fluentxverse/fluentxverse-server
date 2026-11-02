import { getDriver } from "../db/memgraph";
import { mailConfigs } from "./mail/mailConfig";
import { mailProvider } from "./mail/mailProvider";
import { lessonDescription, disputeTime } from "./studentDispute.policy";
import { ClassroomActivityService } from "./classroomActivity.services/classroomActivity.service";
import type { MailDraft } from "../../../shared/mail";

// One short-lived lesson reminder per case. Ambiguous SMTP outcomes need review,
// not blind resends; they never block the later durable inbox explanation request.
export async function dispatchDisputeReminders(now = Date.now()) {
	const s = getDriver().session(),
		activity = new ClassroomActivityService();
	try {
		const rows = await s.run(
			`MATCH(t:LessonIssueThread {origin:'student',state:'queued'})
      WHERE t.tutorIssue IN ['no_show','late_join'] AND t.endsAt > $now AND t.reminderStatus IS NULL
      MATCH(b:Booking {bookingId:t.bookingId}),(u:User {id:t.tutorId}) RETURN t,b,u.email AS email LIMIT 20`,
			{ now: new Date(now).toISOString() },
		);
		for (const row of rows.records) {
			const t = row.get("t").properties,
				b = row.get("b").properties,
				email = row.get("email");
			try {
				const presence = await activity.getTutorPresenceForLesson(
					t.bookingId,
					t.tutorId,
					new Date(t.startsAt),
					new Date(now),
				);
				if (presence.hasJoined && !presence.leftAt) {
					await s.run(
						"MATCH(t:LessonIssueThread {id:$id}) SET t.reminderStatus='not_needed'",
						{ id: t.id },
					);
					continue;
				}
				const account = mailConfigs().find(
					(a) => a.address === "tutor@fluentxverse.com",
				);
				if (!account || !email)
					throw Error("Tutor reminder mailbox or recipient unavailable");
				const claim = await s.executeWrite(async (tx) =>
					tx.run(
						`MATCH(t:LessonIssueThread {id:$id,state:'queued'})
          WHERE t.reminderStatus IS NULL AND t.endsAt > $now SET t.reminderStatus='sending',t.reminderAttemptAt=$now RETURN t`,
						{ id: t.id, now: new Date(Date.now()).toISOString() },
					),
				);
				if (!claim.records.length) continue;
				const text = `Your lesson is ongoing: ${lessonDescription(t.startsAt, t.endsAt)}. The student reported a missing or late tutor. Please join your assigned classroom now.\nhttps://tutor.fluentxverse.com/lesson/${encodeURIComponent(t.bookingId)}\nThis is a lesson reminder, not a request to reply to a dispute during the lesson.`;
				await mailProvider.send(
					account,
					{
						id: t.id,
						accountId: account.id,
						to: email,
						cc: "",
						bcc: "",
						subject: "Your FluentXVerse lesson is waiting",
						text,
						html: "",
						attachments: [],
						inReplyTo: "",
						references: [],
						revision: 0,
						updatedAt: new Date().toISOString(),
					} satisfies MailDraft,
					"lesson-reminder-" + t.id,
				);
				await s.run(
					"MATCH(t:LessonIssueThread {id:$id}) SET t.reminderStatus='sent'",
					{ id: t.id },
				);
			} catch {
				await s.run(
					`MATCH(t:LessonIssueThread {id:$id}) SET t.reminderStatus='review'
          MERGE(n:Notification {id:$notice}) ON CREATE SET n.userId='admin',n.userType='admin',n.type='system',n.title='Lesson reminder delivery needs review',
          n.message='Email delivery was not confirmed. Check the mailbox before resending.',n.timestamp=$now,n.isRead=false`,
					{
						id: t.id,
						notice: "report:reminder-review:" + t.id,
						now: new Date().toISOString(),
					},
				);
			}
		}
	} finally {
		await s.close();
	}
}

export async function reconcilePunctuality(now = Date.now()) {
	const s = getDriver().session(),
		activity = new ClassroomActivityService();
	try {
		const rows = await s.run(
			`MATCH(b:Booking) WHERE b.status IN ['confirmed','completed'] AND b.punctualityCheckedAt IS NULL
      AND b.slotDateTime <= datetime($through) AND b.roomEntryPolicyActivatedAt IS NOT NULL
      RETURN b ORDER BY b.slotDateTime DESC LIMIT 100`,
			{ through: new Date(now - 5 * 60000).toISOString() },
		);
		for (const row of rows.records) {
			const b = row.get("b").properties,
				start = Date.parse(disputeTime(b.slotDateTime));
			// Never interpret unavailable presence storage as evidence of absence.
			const marker = b.tutorRoomEnteredAt
				? Date.parse(disputeTime(b.tutorRoomEnteredAt))
				: Infinity;
			const withinTwo =
				(marker >= start - 300000 && marker <= start + 120000) ||
				(await activity.hasTutorEnteredForLesson(
					b.bookingId,
					b.tutorId,
					new Date(start),
					new Date(start + 120001),
				));
			const withinFive =
				withinTwo ||
				(marker >= start - 300000 && marker <= start + 300000) ||
				(await activity.hasTutorEnteredForLesson(
					b.bookingId,
					b.tutorId,
					new Date(start),
					new Date(start + 300001),
				));
			await s.run(
				`MATCH(b:Booking {bookingId:$id}) WHERE b.punctualityCheckedAt IS NULL
        SET b.lateAtTwoMinutes=$late,b.noEntryWithinFiveMinutes=$missing,b.punctualityCheckedAt=$now`,
				{
					id: b.bookingId,
					late: !withinTwo,
					missing: !withinFive,
					now: new Date(now).toISOString(),
				},
			);
		}
	} finally {
		await s.close();
	}
}
