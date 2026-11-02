import { getDriver } from '../db/memgraph';
import { query } from '../db/postgres';
import { reconcileTutorPenaltyBlock } from './schedule.services/tutorPenaltyBlock';
import { EXPLANATION_WINDOW_MS, explanationExpired, followupMessage, replyText } from './lessonIssueFollowup.policy';
import { lessonStudentIdentity } from '../privacy/lessonNotePrivacy';
import { privateInformationKinds } from '../privacy/personalInformation';

let schema: Promise<void> | undefined;
async function ensureSchema() {
  return schema ||= (async () => {
    const s = getDriver().session();
    try {
      try { await s.run('CREATE CONSTRAINT ON (n:LessonIssueThread) ASSERT n.bookingId IS UNIQUE'); }
      catch {
        const info = await s.run('SHOW CONSTRAINT INFO');
        if (!info.records.some(r => r.get('label') === 'LessonIssueThread' && r.get('constraint type') === 'unique' && r.get('properties').join(',') === 'bookingId')) throw Error('Thread uniqueness unavailable');
      }
    } finally { await s.close(); }
  })().catch(e => { schema = undefined; throw e; });
}

export class LessonIssueFollowupService {
  constructor(private readonly clock = () => Date.now()) {}
  async authorize(id: string, actor: { id: string; role: 'admin' | 'tutor' }) {
    const s = getDriver().session();
    try {
      const r = await s.run("MATCH(t:LessonIssueThread {id:$id}) WHERE t.origin IS NULL AND ($admin OR t.tutorId=$actor) RETURN t", { id, admin: actor.role === 'admin', actor: actor.id });
      if (!r.records.length) throw Error('Conversation not found');
    } finally { await s.close(); }
  }

  async decide(id: string, actorId: string, decision: string, reason: unknown, expectedRevision: number) {
    if (!['ta301', 'no_penalty', 'past'].includes(decision)) throw Error('Invalid staff decision');
    const explanation = replyText(reason), s = getDriver().session();
    try {
      await s.executeWrite(async tx => {
        const admin = await tx.run("MATCH(a:Admin {id:$actorId}) WHERE a.role IN ['admin','superadmin'] RETURN a", { actorId });
        if (!admin.records.length) throw Error('Staff access required');
        const rows = await tx.run('MATCH(t:LessonIssueThread {id:$id}) WHERE t.origin IS NULL SET t.writeRevision=coalesce(t.writeRevision,0)+1 RETURN t', { id });
        const t = rows.records[0]?.get('t').properties;
        if (!t) throw Error('Conversation not found');
        if (Number(t.decisionRevision || 0) !== expectedRevision) throw Error('Decision changed. Refresh before deciding again.');
        if (privateInformationKinds(explanation, await lessonStudentIdentity(tx, t.bookingId)).length) throw Error('Remove student personal information from the decision.');
        const now = new Date(this.clock()).toISOString();
        const booking = await tx.run(`MATCH(b:Booking {bookingId:$bookingId}) SET b.compensationWriteRevision=coalesce(b.compensationWriteRevision,0)+1 RETURN b`, { bookingId: t.bookingId });
        const b = booking.records[0]?.get('b').properties;
        if (!b) throw Error('Lesson not found');
        if (b.status === 'cancelled' && decision === 'ta301') throw Error('Cancelled lessons cannot receive this penalty');
        if (t.state === decision && t.decidedBy === actorId && t.decisionReason === explanation) return;
        await tx.run(`MATCH(p:Penalty {bookingId:$bookingId}) WHERE p.revokedAt IS NULL AND coalesce(p.status,'') <> 'voided'
          SET p.status='voided',p.revokedAt=$now,p.revocationReason=$reason`, { bookingId: t.bookingId, now, reason: explanation });
        await tx.run(`MATCH(b:Booking {bookingId:$bookingId}) REMOVE b.penaltyCode,b.penaltyReason,b.penaltyTimestamp
          SET b.issueDecision=$decision,b.issueDecisionBy=$actorId,b.issueDecisionAt=$now`, { bookingId: t.bookingId, decision, actorId, now });
        if (decision === 'ta301') await tx.run(`MATCH(u:User {id:$tutorId}),(b:Booking {bookingId:$bookingId})
          CREATE(p:Penalty {penaltyId:$penaltyId,bookingId:$bookingId,tutorId:$tutorId,penaltyCode:'301',penaltyReason:$reason,
            status:'active',severity:'critical',affectsCompensation:true,createdAt:datetime($now),source:'issue_staff_decision'})
          CREATE(u)-[:HAS_PENALTY]->(p) SET b.penaltyCode='301',b.penaltyReason=$reason,b.penaltyTimestamp=datetime($now)`, {
          tutorId: t.tutorId, bookingId: t.bookingId, penaltyId: crypto.randomUUID(), reason: explanation, now,
        });
        await tx.run(`MATCH(b:Booking {bookingId:$bookingId})-[:BOOKS]->(slot:TimeSlot)
          SET slot.status=CASE WHEN $past THEN 'past' ELSE 'booked' END,
            slot.issueRemoved=$past,slot.updatedAt=datetime($now)`, { bookingId: t.bookingId, past: decision === 'past', now });
        await tx.run(`MATCH(t:LessonIssueThread {id:$id})
          SET t.state=$decision,t.decisionReason=$reason,t.decidedBy=$actorId,t.decidedAt=$now,t.decisionRevision=$revision
          CREATE(a:LessonIssueDecision {id:$auditId,bookingId:$bookingId,decision:$decision,reason:$reason,actorId:$actorId,
            createdAt:$now,previousState:$previousState,previousBookingJson:$snapshot}) CREATE(t)-[:HAS_DECISION]->(a)`, {
          id, decision, reason: explanation, actorId, now, revision: expectedRevision + 1, auditId: crypto.randomUUID(),
          bookingId: t.bookingId, previousState: t.state, snapshot: JSON.stringify(b),
        });
        await reconcileTutorPenaltyBlock(tx, t.tutorId, true);
        await tx.run(`CREATE(n:Notification {id:$id,userId:$tutorId,userType:'tutor',type:'system',title:'Lesson issue decision',
          message:$message,timestamp:$now,isRead:false,data:$data})`, { id: 'report:issue-decision:' + crypto.randomUUID(), tutorId: t.tutorId,
          message: `${decision === 'past' ? 'Delete slot (PAST)' : decision === 'ta301' ? 'TA-301' : 'No penalty'}: ${explanation}`, now,
          data: JSON.stringify({ bookingId: t.bookingId, link: '/inbox' }) });
      });
    } finally { await s.close(); }
  }
  async open(bookingId: string, tutorId: string, reportId: string) {
    await ensureSchema(); const s = getDriver().session();
    try {
      return await s.executeWrite(async tx => {
        const found = await tx.run(`MATCH (b:Booking {bookingId:$bookingId,tutorId:$tutorId}) RETURN b`, { bookingId, tutorId });
        const b = found.records[0]?.get('b').properties;
        if (!b) throw Error('Lesson not found');
        const startsAt = b.slotDateTime?.toStandardDate?.().toISOString() || new Date(b.slotDateTime).toISOString();
        const minutes = Number(b.durationMinutes ?? 25), now = new Date(this.clock()).toISOString(), deadline = new Date(this.clock() + EXPLANATION_WINDOW_MS).toISOString();
        const result = await tx.run(`MATCH(b:Booking {bookingId:$bookingId})
          MERGE(t:LessonIssueThread {bookingId:$bookingId}) ON CREATE SET t.id=$reportId,t.tutorId=$tutorId,
            t.createdAt=$now,t.deadline=$deadline,t.state='awaiting_tutor',t.body=$body,t.startsAt=$startsAt
          MERGE(b)-[:HAS_ISSUE_THREAD]->(t) RETURN t`, {
          bookingId, tutorId, reportId, now, deadline, startsAt, body: followupMessage(startsAt, minutes, deadline),
        });
        const thread = result.records[0]!.get('t').properties;
        if (thread.origin === 'student') throw Error('Student report already owns this lesson case');
        await tx.run(`MERGE(n:Notification {id:$id}) ON CREATE SET n.userId=$tutorId,n.userType='tutor',
          n.type='system',n.title='Lesson issue: explanation required',n.message=$message,n.timestamp=$now,
          n.isRead=false,n.data=$data`, { id: 'report:issue-followup:' + thread.id, tutorId, message: thread.body, now: thread.createdAt,
          data: JSON.stringify({ bookingId, link: '/inbox' }) });
        return thread;
      });
    } finally { await s.close(); }
  }

  async list(tutorId?: string) {
    const s = getDriver().session();
    try {
      const rows = await s.run(`MATCH(t:LessonIssueThread) WHERE t.origin IS NULL AND ($tutorId IS NULL OR t.tutorId=$tutorId)
        RETURN t ORDER BY t.createdAt DESC LIMIT 100`, { tutorId: tutorId ?? null });
      const threads = [];
      for (const row of rows.records) {
        const thread = row.get('t').properties;
        const messages = await s.run(`MATCH(t:LessonIssueThread {bookingId:$bookingId})-[:HAS_REPLY]->(r:LessonIssueReply)
          RETURN r ORDER BY r.createdAt,r.id LIMIT 500`, { bookingId: thread.bookingId });
        threads.push({ ...thread, decisionRevision: Number(thread.decisionRevision || 0), replies: messages.records.map(r => {
          const p = r.get('r').properties; return { ...p, attachments: JSON.parse(p.attachmentsJson || '[]') };
        }) });
      }
      return threads;
    } finally { await s.close(); }
  }

  async reply(id: string, actor: { id: string; role: 'admin' | 'tutor' }, text: unknown, attachments: { id: string }[] = []) {
    const body = replyText(text), s = getDriver().session();
    try {
      await s.executeWrite(async tx => {
        // Deadline enforcement and replies contend on this same record, including across API replicas.
        const rows = await tx.run(`MATCH(t:LessonIssueThread {id:$id}) WHERE t.origin IS NULL AND ($admin OR t.tutorId=$actor)
          SET t.writeRevision=coalesce(t.writeRevision,0)+1 RETURN t`, { id, admin: actor.role === 'admin', actor: actor.id });
        const t = rows.records[0]?.get('t').properties;
        if (!t) throw Error('Conversation not found');
        const now = this.clock();
        if (privateInformationKinds(body, await lessonStudentIdentity(tx, t.bookingId)).length)
          throw Error('Remove student personal information from your reply. Use "the student" instead.');
        if (actor.role === 'tutor' && t.state === 'awaiting_tutor' && explanationExpired(t.deadline, now))
          throw Error('The 24-hour reply deadline has passed. Contact support for review.');
        await tx.run(`MATCH(t:LessonIssueThread {id:$id}) CREATE(r:LessonIssueReply {id:$replyId,role:$role,
          actorId:$actor,body:$body,createdAt:$now,attachmentsJson:$attachments}) CREATE(t)-[:HAS_REPLY]->(r)
          SET t.state=CASE WHEN $tutor AND t.state='awaiting_tutor' THEN 'awaiting_admin' ELSE t.state END,
            t.firstTutorReplyAt=CASE WHEN $tutor AND t.firstTutorReplyAt IS NULL THEN $now ELSE t.firstTutorReplyAt END`, {
          id, replyId: crypto.randomUUID(), role: actor.role, tutor: actor.role === 'tutor', actor: actor.id, body, now: new Date(now).toISOString(), attachments: JSON.stringify(attachments),
        });
      });
    } finally { await s.close(); }
  }

  async enforceDeadlines() {
    const s = getDriver().session();
    try {
      const due = await s.run(`MATCH(t:LessonIssueThread) WHERE t.origin IS NULL AND t.state='awaiting_tutor' AND t.deadline <= $now RETURN t.id AS id LIMIT 100`, { now: new Date(this.clock()).toISOString() });
      for (const row of due.records) {
        try { await s.executeWrite(async tx => {
        const locked = await tx.run(`MATCH(t:LessonIssueThread {id:$id}) SET t.writeRevision=coalesce(t.writeRevision,0)+1 RETURN t`, { id: row.get('id') });
        const t = locked.records[0]?.get('t').properties;
        if (!t || t.state !== 'awaiting_tutor' || t.firstTutorReplyAt || !explanationExpired(t.deadline, this.clock())) return;
        const booking = await tx.run(`MATCH(b:Booking {bookingId:$bookingId,tutorId:$tutorId})
          SET b.compensationWriteRevision=coalesce(b.compensationWriteRevision,0)+1 RETURN b`, t);
        const b = booking.records[0]?.get('b').properties;
        if (!b) throw Error('Follow-up lesson missing');
        if (b.status === 'cancelled') {
          await tx.run("MATCH(t:LessonIssueThread {id:$id}) SET t.state='cancelled'", { id: t.id }); return;
        }
        const reason = 'No explanation within 24 hours of the Other student-related issue inbox message';
        const existing = await tx.run(`MATCH(p:Penalty {bookingId:$bookingId,penaltyCode:'301'})
          WHERE p.revokedAt IS NULL AND coalesce(p.status,'') <> 'voided' RETURN p LIMIT 1`, { bookingId: t.bookingId });
        if (!existing.records.length) await tx.run(`MATCH(u:User {id:$tutorId})
          CREATE(p:Penalty {penaltyId:$penaltyId,tutorId:$tutorId,bookingId:$bookingId,penaltyCode:'301',
            penaltyReason:$reason,severity:'critical',affectsCompensation:true,createdAt:datetime($now),source:'issue_reply_timeout'})
          CREATE(u)-[:HAS_PENALTY]->(p)`, { tutorId: t.tutorId, bookingId: t.bookingId, penaltyId: 'issue-timeout-' + t.id, reason, now: new Date(this.clock()).toISOString() });
        await tx.run(`MATCH(b:Booking {bookingId:$bookingId}),(t:LessonIssueThread {id:$id})
          SET b.penaltyCode='301',b.penaltyReason=$reason,b.penaltyTimestamp=datetime($now),
            t.state='ta301',t.penalizedAt=$now
          CREATE(a:LessonAttendanceAudit {id:$auditId,bookingId:$bookingId,actorId:'system',actorRole:'system',
            subject:'penalty',status:'301',reason:$reason,createdAt:$now})`, {
          bookingId: t.bookingId, id: t.id, reason, now: new Date(this.clock()).toISOString(), auditId: crypto.randomUUID(),
        });
        await reconcileTutorPenaltyBlock(tx, t.tutorId);
        }); } catch { console.error('Lesson issue deadline enforcement will retry for thread', row.get('id')); }
      }
    } finally { await s.close(); }
  }

  async dispatch() {
    const rows = await query(`SELECT id,booking_id,tutor_id FROM lesson_trouble_reports
      WHERE reason='student' AND student_issue='other' AND followup_dispatched_at IS NULL
      ORDER BY followup_last_attempt_at NULLS FIRST,created_at LIMIT 100`);
    for (const row of rows.rows) {
      await query('UPDATE lesson_trouble_reports SET followup_last_attempt_at=NOW() WHERE id=$1', [row.id]);
      try {
        await this.open(row.booking_id, row.tutor_id, row.id);
        await query('UPDATE lesson_trouble_reports SET followup_dispatched_at=NOW() WHERE id=$1', [row.id]);
      } catch { console.error('Lesson issue inbox dispatch will retry for report', row.id); }
    }
  }
}
export const lessonIssueFollowupService = new LessonIssueFollowupService();
