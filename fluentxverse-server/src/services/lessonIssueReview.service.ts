import { query } from '../db/postgres';
import { LessonTroubleReportService } from './lessonTroubleReport.service';
import { StudentLessonIssueReportService } from './studentLessonIssueReport.service';
import { getDriver } from '../db/memgraph';
import { invalidateCache } from '../db/redis';
import { ClassroomNotesService } from './classroomNotes.services/classroomNotes.service';
import { lessonNotice, lessonOutcome, invalidateLessonCaches } from './lessonWorkflow.service';
import { studentTutorIssueLabel } from '../utils/studentTutorIssues';
import { tutorStudentIssueLabel } from '../utils/tutorStudentIssues';
import { reconcileTutorPenaltyBlock } from './schedule.services/tutorPenaltyBlock';

export async function ensureIssueReviewColumns(table: 'lesson_trouble_reports' | 'student_lesson_issue_reports') {
  await query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'submitted',
    ADD COLUMN IF NOT EXISTS resolution TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviewed_by TEXT, ADD COLUMN IF NOT EXISTS ticket_transaction_id TEXT,
    ADD COLUMN IF NOT EXISTS attendance_correction TEXT,
    ADD COLUMN IF NOT EXISTS review_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS assignee_id TEXT, ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS internal_history JSONB NOT NULL DEFAULT '[]'::jsonb`);
}
export function reviewFields(row: any) {
  return { status: row.review_status || 'submitted', resolution: row.resolution || '',
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    ticketTransactionId: row.ticket_transaction_id || null, attendanceCorrection: row.attendance_correction || null };
}

export class LessonIssueReviewService {
  private table(source: string) {
    if (source !== 'student' && source !== 'tutor') throw new Error('Invalid report source');
    return source === 'student' ? 'student_lesson_issue_reports' : 'lesson_trouble_reports';
  }
  async list() {
    await new LessonTroubleReportService().ensureSchema();
    await new StudentLessonIssueReportService().ensureSchema();
    const result = await query(`SELECT id, booking_id, tutor_id AS reporter_id, 'tutor' AS source, duration, reason,
      '' AS details, NULL::TEXT AS tutor_issue, student_issue, created_at, review_status, resolution, reviewed_at, ticket_transaction_id, attendance_correction,
      assignee_id, priority, due_at, internal_history, review_history FROM lesson_trouble_reports
      UNION ALL SELECT id, booking_id, student_id AS reporter_id, 'student' AS source, duration, reason,
      details, tutor_issue, NULL::TEXT AS student_issue, created_at, review_status, resolution, reviewed_at, ticket_transaction_id, attendance_correction,
      assignee_id, priority, due_at, internal_history, review_history FROM student_lesson_issue_reports
      ORDER BY created_at DESC`);
    return result.rows.map((row: any) => ({ id: row.id, bookingId: row.booking_id, source: row.source,
      reporterId: row.reporter_id, duration: row.duration, reason: row.reason, details: row.details,
      tutorIssue: row.tutor_issue || null, tutorIssueLabel: studentTutorIssueLabel(row.tutor_issue),
      studentIssue: row.student_issue || null, studentIssueLabel: tutorStudentIssueLabel(row.student_issue),
      createdAt: new Date(row.created_at).toISOString(), assigneeId: row.assignee_id || '', priority: row.priority,
      dueAt: new Date(row.due_at || new Date(row.created_at).getTime() + 86400000).toISOString(),
      internalHistory: row.internal_history || [], reviewHistory: row.review_history || [], ...reviewFields(row) }));
  }
  async updateCase(source: string, id: string, actorId: string, assigneeId: string, priority: string, comment: string) {
    await this.list();
    if (!['normal', 'high', 'urgent'].includes(priority)) throw new Error('Invalid priority');
    if (!comment.trim() || comment.length > 2000) throw new Error('An internal update between 1 and 2000 characters is required.');
    if (assigneeId) {
      const db = getDriver().session();
      try { if (!(await db.run('MATCH (a:Admin {id: $id}) RETURN a', { id: assigneeId })).records.length) throw new Error('Assignee not found'); }
      finally { await db.close(); }
    }
    const result = await query(`UPDATE ${this.table(source)} SET assignee_id = $2, priority = $3,
      due_at = coalesce(due_at, created_at + INTERVAL '24 hours'), internal_history = internal_history ||
      jsonb_build_array(jsonb_build_object('actorId', $4::text, 'comment', $5::text, 'assigneeId', $2::text, 'priority', $3::text, 'at', NOW()))
      WHERE id = $1 RETURNING id`, [id, assigneeId || null, priority, actorId, comment.trim()]);
    if (!result.rows.length) throw new Error('Report not found');
    return (await this.list()).find((r: any) => r.id === id && r.source === source);
  }
  async review(source: string, id: string, adminId: string, status: string, resolution: string, ticketTransactionId?: string) {
    await this.list();
    if (!['submitted', 'under_review', 'resolved'].includes(status)) throw new Error('Invalid review status');
    if (status === 'resolved' && !resolution.trim()) throw new Error('A resolution is required.');
    const table = this.table(source);
    const report = (await query(`SELECT * FROM ${table} WHERE id = $1`, [id])).rows[0];
    if (!report) throw new Error('Report not found');
    const session = getDriver().session();
    try {
      if (ticketTransactionId) {
        const result = await session.run(`MATCH (t:TicketTransaction {id: $id, bookingId: $bookingId, status: 'completed'})
          WHERE t.type IN ['cancellation', 'refund'] RETURN t`, { id: ticketTransactionId, bookingId: report.booking_id });
        if (!result.records.length) throw new Error('Select a completed refund transaction belonging to this lesson.');
      }
      await query(`UPDATE ${table} SET review_status = $2, resolution = $3, reviewed_at = NOW(), reviewed_by = $4,
        ticket_transaction_id = $5, review_history = review_history || jsonb_build_array(jsonb_build_object(
          'status', $2::text, 'resolution', $3::text, 'actorId', $4::text, 'ticketTransactionId', $5::text, 'at', NOW()))
        WHERE id = $1`, [id, status, resolution.trim(), adminId, ticketTransactionId || null]);
      await session.executeWrite(async tx => {
        const version = `${status}:${resolution.trim()}:${ticketTransactionId || ''}`;
        await lessonNotice(tx, `report:${id}:${version}`, report.student_id || report.tutor_id, source, report.booking_id,
          'Lesson issue report updated', status === 'resolved' ? 'Your lesson issue report has been resolved. View the outcome on the lesson page.' : 'Your lesson issue report is under review.');
      });
      return (await this.list()).find((row: any) => row.id === id);
    } finally { await session.close(); }
  }
  async attendanceHistory(bookingId: string) {
    const session = getDriver().session();
    try {
      const result = await session.run('MATCH (a:LessonAttendanceAudit {bookingId: $bookingId}) RETURN a ORDER BY a.createdAt DESC', { bookingId });
      return result.records.map(row => { const a = row.get('a').properties; return { ...a, canRestore: Boolean(a.snapshotJson), snapshotJson: undefined }; });
    } finally { await session.close(); }
  }
  async correctAttendance(bookingId: string, adminId: string, status: 'present' | 'absent', reason: string, subject: 'student' | 'tutor' = 'student') {
    if (!reason.trim()) throw new Error('A correction reason is required.');
    const session = getDriver().session();
    try {
      const row = (await session.run('MATCH (b:Booking {bookingId: $bookingId}) RETURN b.tutorId AS tutorId', { bookingId })).records[0];
      if (!row) throw new Error('Lesson not found');
      if (subject === 'student') await new ClassroomNotesService().setStudentAttendance(bookingId, row.get('tutorId'), status, reason, adminId);
      else await session.executeWrite(async tx => {
        const tutorId = row.get('tutorId');
        await tx.run(`MATCH (t:User {id: $tutorId})
          SET t.scheduleWriteVersion = coalesce(t.scheduleWriteVersion, 0) + 1`, { tutorId });
        const previous = (await tx.run(`MATCH (b:Booking {bookingId: $bookingId}) SET b.lessonNotesWriteVersion = coalesce(b.lessonNotesWriteVersion, 0) + 1 RETURN b`, { bookingId })).records[0]!.get('b').properties;
        const outcome = lessonOutcome({ ...previous, attendanceTutor: status });
        await tx.run(`MATCH (b:Booking {bookingId: $bookingId}) SET b.attendanceTutor = $status, b.attendanceSource = 'admin', b.lessonOutcome = $outcome,
          b.attendanceStatus = $attendance, b.updatedAt = datetime()
          CREATE (:LessonAttendanceAudit {id: $id, bookingId: $bookingId, actorId: $adminId, actorRole: 'admin', subject: 'tutor',
            previousStatus: $previous, status: $status, reason: $reason, createdAt: $now})`,
          { bookingId, adminId, status, outcome, attendance: outcome === 'attended' ? 'present' : outcome.endsWith('_absent') ? 'absent' : null,
            id: crypto.randomUUID(), previous: previous.attendanceTutor || 'unset', reason: reason.trim(), now: new Date().toISOString() });
        if (status === 'present') {
          await tx.run(`MATCH (p:Penalty {tutorId: $tutorId, bookingId: $bookingId, penaltyCode: '301'})
            SET p.status = 'voided', p.revokedAt = $now, p.revocationReason = $reason`,
            { tutorId, bookingId, now: new Date().toISOString(), reason: reason.trim() });
          await tx.run(`MATCH (b:Booking {bookingId: $bookingId}) WHERE b.penaltyCode = '301'
            REMOVE b.penaltyCode, b.penaltyReason, b.penaltyTimestamp`, { bookingId });
        } else if (previous.status !== 'cancelled') {
          await tx.run(`MATCH (t:User {id: $tutorId}), (b:Booking {bookingId: $bookingId})
            MERGE (p:Penalty {tutorId: $tutorId, bookingId: $bookingId, penaltyCode: '301'})
            ON CREATE SET p.penaltyId = $id, p.createdAt = datetime()
            SET p.status = 'active', p.penaltyReason = $reason, p.severity = 'critical', p.affectsCompensation = true,
              b.penaltyCode = '301', b.penaltyReason = $reason, b.penaltyTimestamp = datetime()
            REMOVE p.revokedAt, p.revocationReason
            MERGE (t)-[:HAS_PENALTY]->(p)`, { tutorId, bookingId, id: crypto.randomUUID(), reason: reason.trim() });
        }
        await reconcileTutorPenaltyBlock(tx, tutorId, true);
      });
      for (const table of ['lesson_trouble_reports', 'student_lesson_issue_reports'] as const) {
        await this.list();
        await query(`UPDATE ${table} SET attendance_correction = $2 WHERE booking_id = $1`, [bookingId, subject === 'student' ? status : `Tutor: ${status}`]);
      }
      await invalidateLessonCaches(bookingId);
      if (subject === 'tutor') await invalidateCache('tutor:search:*');
    } finally { await session.close(); }
  }
  async restore(bookingId: string, auditId: string, adminId: string, reason: string) {
    if (!reason.trim()) throw new Error('A recovery reason is required.');
    const session = getDriver().session();
    try {
      await session.executeWrite(async tx => {
        const row = (await tx.run(`MATCH (b:Booking {bookingId: $bookingId})
          SET b.lessonNotesWriteVersion = coalesce(b.lessonNotesWriteVersion, 0) + 1
          WITH b MATCH (a:LessonAttendanceAudit {id: $auditId, bookingId: $bookingId}) RETURN b, a`, { bookingId, auditId })).records[0];
        if (!row) throw new Error('Recovery archive not found');
        const b = row.get('b').properties;
        if (b.attendanceStudent !== 'absent') throw new Error('Recovery is only available while the student is marked absent. Existing notes will not be overwritten.');
        const snapshot = JSON.parse(row.get('a').properties.snapshotJson || '{}');
        if (!snapshot.nodes?.length) throw new Error('This attendance change has no notes to recover.');
        const existing = await tx.run('MATCH (n) WHERE n.sessionId = $bookingId AND (n:ClassroomMaterialNote OR n:ClassroomLessonNote OR n:PublishedLessonNotes) RETURN n LIMIT 1', { bookingId });
        if (existing.records.length) throw new Error('Existing notes cannot be overwritten by recovery.');
        for (const node of snapshot.nodes) {
          const label = node.labels.find((label: string) => ['ClassroomMaterialNote', 'ClassroomLessonNote', 'PublishedLessonNotes'].includes(label));
          if (!label || node.properties.sessionId !== bookingId) throw new Error('Invalid recovery archive');
          await tx.run(`CREATE (n:${label}) SET n = $properties`, { properties: node.properties });
          if (label === 'ClassroomMaterialNote') await tx.run(`MATCH (b:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(s:Student)
            MATCH (n:ClassroomMaterialNote {key: $key}) MERGE (b)-[:HAS_CLASSROOM_NOTE]->(n) MERGE (s)-[:HAS_CLASSROOM_NOTE]->(n)`, { bookingId, key: node.properties.key });
        }
        await tx.run(`MATCH (b:Booking {bookingId: $bookingId}) SET b.attendanceStudent = 'present', b.notesSubmittedAt = $submittedAt,
          b.notesDraftDirty = $dirty, b.lessonOutcome = $outcome, b.attendanceStatus = $attendance,
          b.studentAttendanceUpdatedBy = $adminId, b.studentAttendanceUpdatedAt = datetime()
          CREATE (:LessonAttendanceAudit {id: $id, bookingId: $bookingId, actorId: $adminId, actorRole: 'admin',
            previousStatus: 'absent', status: 'present', reason: $reason, recoveredFrom: $auditId, createdAt: $now})`,
          { bookingId, adminId, submittedAt: snapshot.notesSubmittedAt || null, dirty: Boolean(snapshot.notesDraftDirty) || !snapshot.notesSubmittedAt,
            outcome: lessonOutcome({ ...b, attendanceStudent: 'present' }), attendance: b.attendanceTutor === 'present' ? 'present' : b.attendanceTutor === 'absent' ? 'absent' : null,
            id: crypto.randomUUID(), auditId, reason: reason.trim(), now: new Date().toISOString() });
      });
      await invalidateLessonCaches(bookingId);
    } finally { await session.close(); }
  }
}
export const lessonIssueReviewService = new LessonIssueReviewService();
