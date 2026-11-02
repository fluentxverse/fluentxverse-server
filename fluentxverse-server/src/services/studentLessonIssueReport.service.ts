import { query } from '../db/postgres';
import { lessonReportingWindow } from '../utils/lessonReportingWindow';
import type { TroubleDuration } from './lessonTroubleReport.service';
import { ensureIssueReviewColumns, reviewFields } from './lessonIssueReview.service';
import { getDriver } from '../db/memgraph';
import { lessonNotice, dispatchLessonNotices } from './lessonWorkflow.service';
import type { StudentLessonService } from './studentLesson.service';
import { studentDisputeService } from './studentDispute.service';
import { studentTutorIssueLabel, validateStudentTutorIssue } from '../utils/studentTutorIssues';

export type StudentLessonIssueReason = 'connection' | 'audio' | 'hardware' | 'emergency' | 'power' | 'tutor' | 'material' | 'other';

export function studentIssueReportWindow(startsAt: string, durationMinutes: number, status: string, now = Date.now(), tutorHasJoined = true, tutorLeftAt: number | null = null) {
  const window = lessonReportingWindow(startsAt, durationMinutes, status, now);
  const duringLesson = now < Date.parse(window.endsAt);
  const disconnected = tutorLeftAt !== null && tutorLeftAt >= Date.parse(window.startsAt) && tutorLeftAt <= now;
  const availableAt = Date.parse(window.startsAt) + 2 * 60000;
  const reason = window.reason || (duringLesson && now < availableAt ? 'waiting_for_tutor' : null);
  return { startsAt: window.startsAt, lessonEndsAt: window.endsAt, closesAt: window.closesAt,
    serverNow: window.serverNow, eligible: reason === null, reason,
    availableAt: duringLesson ? new Date(availableAt).toISOString() : null,
    duringLessonTutorIssue: duringLesson ? disconnected ? 'left_early' as const : 'no_show' as const : null };
}

export class StudentLessonIssueReportService {
  private schemaReady: Promise<void> | null = null;
  async getReportingWindow(bookingId: string, lesson: Awaited<ReturnType<StudentLessonService['getOwnedLesson']>>, now = Date.now()) {
    return studentIssueReportWindow(lesson.startsAt, lesson.durationMinutes, lesson.status, now);
  }
  async ensureSchema() {
    if (!this.schemaReady) this.schemaReady = query(`CREATE TABLE IF NOT EXISTS student_lesson_issue_reports (
      id TEXT PRIMARY KEY, booking_id TEXT NOT NULL UNIQUE, student_id TEXT NOT NULL,
      duration TEXT NOT NULL CHECK (duration IN ('up_to_ten', 'over_ten')),
      reason TEXT NOT NULL CHECK (reason IN ('connection', 'audio', 'hardware', 'emergency', 'power', 'tutor', 'material', 'other')),
      details TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).then(async () => {
      await ensureIssueReviewColumns('student_lesson_issue_reports');
      await query('ALTER TABLE student_lesson_issue_reports ADD COLUMN IF NOT EXISTS tutor_notified_at TIMESTAMPTZ');
      await query('ALTER TABLE student_lesson_issue_reports ADD COLUMN IF NOT EXISTS tutor_issue TEXT');
    }).catch(error => { this.schemaReady = null; throw error; });
    await this.schemaReady;
  }
  async get(bookingId: string, studentId: string) {
    const current = await studentDisputeService.get(bookingId, studentId);
    if (current) return current;
    await this.ensureSchema();
    const result = await query('SELECT * FROM student_lesson_issue_reports WHERE booking_id = $1 AND student_id = $2', [bookingId, studentId]);
    return result.rows[0] ? this.map(result.rows[0]) : null;
  }
  async getForTutor(bookingId: string, tutorId: string) {
    const visible = (await studentDisputeService.list({id:tutorId,role:'tutor'})).find(t=>t.bookingId===bookingId);
    const graph = getDriver().session();
    try {
      if ((await graph.run("MATCH(t:LessonIssueThread {bookingId:$bookingId,origin:'student'}) RETURN t",{bookingId})).records.length)
        return visible ? {id:visible.id,details:visible.body,status:visible.state,resolution:visible.decisionReason,tutorIssueLabel:null} : null;
    } finally {await graph.close();}
    await this.ensureSchema();
    const session = getDriver().session();
    try {
      const owner = (await session.run('MATCH (:Booking {bookingId: $bookingId, tutorId: $tutorId})-[:BOOKED_BY]->(s:Student) RETURN s.id AS studentId', { bookingId, tutorId })).records[0];
      if (!owner) throw new Error('Booking not found or you do not have access to this lesson');
      return await this.get(bookingId, owner.get('studentId'));
    } finally { await session.close(); }
  }
  async dispatchTutorNotifications() {
    await this.ensureSchema();
    const pending = await query('SELECT id, booking_id, student_id FROM student_lesson_issue_reports WHERE tutor_notified_at IS NULL ORDER BY created_at LIMIT 100');
    const session = getDriver().session();
    try {
      for (const report of pending.rows) {
        await session.executeWrite(async tx => {
          const owner = (await tx.run('MATCH (b:Booking {bookingId: $bookingId})-[:BOOKED_BY]->(:Student {id: $studentId}) RETURN b.tutorId AS tutorId', { bookingId: report.booking_id, studentId: report.student_id })).records[0];
          if (!owner) return;
          await lessonNotice(tx, `report:${report.id}:received:tutor`, owner.get('tutorId'), 'tutor', report.booking_id,
            'Lesson report received', 'The student reported an issue with this lesson. Open the lesson page to review it.');
        });
        await query('UPDATE student_lesson_issue_reports SET tutor_notified_at = NOW() WHERE id = $1', [report.id]);
      }
      await dispatchLessonNotices();
    } finally { await session.close(); }
  }
  async create(bookingId: string, studentId: string, duration: TroubleDuration, reason: StudentLessonIssueReason, details: string, tutorIssue?: string, duringLesson = false, duringLessonTutorIssue = 'no_show') {
    validateStudentTutorIssue(reason, tutorIssue, details, duringLesson, duringLessonTutorIssue);
    await this.ensureSchema();
    if ((await query('SELECT id FROM student_lesson_issue_reports WHERE booking_id=$1',[bookingId])).rows.length) return null;
    return studentDisputeService.create(bookingId,studentId,reason,details.trim(),tutorIssue);
  }
  private map(row: any) { return { id: row.id, duration: row.duration, reason: row.reason, details: row.details,
    tutorIssue: row.tutor_issue || null, tutorIssueLabel: studentTutorIssueLabel(row.tutor_issue),
    createdAt: new Date(row.created_at).toISOString(), ...reviewFields(row) }; }
}
