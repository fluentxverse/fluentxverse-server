import { getDriver } from '../../db/memgraph';
import { query } from '../../db/postgres';
import { LessonNotesReadOnly } from '../../utils/lessonNotesEditWindow';
import { LessonTroubleReportService } from '../lessonTroubleReport.service';
import { StudentLessonIssueReportService } from '../studentLessonIssueReport.service';
import { assessLessonOutcome, type OutcomeInput } from './policy';
import { createHash } from 'node:crypto';

const iso = (value: any): string => value?.toStandardDate ? value.toStandardDate().toISOString() : new Date(value).toISOString();

export class LessonOutcomeService {
  async inspect(bookingId: string) {
    const session = getDriver().session();
    let b: Record<string, any>, studentId: string, hasActiveTa301: boolean, hasGraphReport = false;
    try {
      const result = await session.run(`MATCH (b:Booking {bookingId:$bookingId})-[:BOOKED_BY]->(s:Student)
        OPTIONAL MATCH (p:Penalty {bookingId:$bookingId,penaltyCode:'301'})
        WHERE p.revokedAt IS NULL AND coalesce(p.status,'') <> 'voided'
        RETURN b,s.id AS studentId,count(p)>0 AS hasActiveTa301`, { bookingId });
      if (!result.records[0]) throw new LessonNotesReadOnly('Lesson not found or you do not have access');
      b = result.records[0].get('b').properties;
      studentId = result.records[0].get('studentId');
      hasActiveTa301 = result.records[0].get('hasActiveTa301');
      hasGraphReport = (await session.run("MATCH(t:LessonIssueThread {bookingId:$bookingId,origin:'student'}) RETURN t.id AS id",{bookingId})).records.length>0;
    } finally { await session.close(); }
    await new LessonTroubleReportService().ensureSchema();
    await new StudentLessonIssueReportService().ensureSchema();
    const reports = await query(`SELECT 'student' AS source, student_id AS reporter, review_status,
      completion_decision, completion_outcome FROM student_lesson_issue_reports WHERE booking_id=$1
      UNION ALL SELECT 'tutor' AS source, tutor_id AS reporter, review_status,
      completion_decision, completion_outcome FROM lesson_trouble_reports WHERE booking_id=$1`, [bookingId]);
    const startsAt = iso(b.slotDateTime), durationMinutes = Number(b.durationMinutes ?? 25);
    const end = Date.parse(startsAt) + durationMinutes * 60_000;
    if (!Number.isFinite(end)) throw new Error('Lesson timing is unavailable.');
    const observed = await query(`SELECT user_type, joined_at, last_seen_at, left_at FROM session_participants
      WHERE session_id=$1 AND ((user_type='student' AND user_id=$2) OR (user_type='tutor' AND user_id=$3))
        AND joined_at<$4::timestamptz ORDER BY joined_at,user_type,id LIMIT 10001`, [b.sessionId || bookingId, studentId, b.tutorId, new Date(end)]);
    if (observed.rows.length > 10000) throw new Error('Attendance records require support review.');
    const input: OutcomeInput = { startsAt, durationMinutes, status: b.issueDecision === 'past' ? 'past' : b.status,
      attendanceTutor: b.attendanceTutor, attendanceStudent: b.attendanceStudent,
      tutorAbsencePenalty: hasActiveTa301 ? 'active' : b.penaltyCode === '301' ? 'booking_marker' : 'none',
      presence: observed.rows.map((r: any) => ({ role: r.user_type, joinedAt: iso(r.joined_at),
        lastSeenAt: r.last_seen_at ? iso(r.last_seen_at) : null, leftAt: r.left_at ? iso(r.left_at) : null })),
      reports: [...(b.disputeHold ? [{source:'student' as const,status:'under_review',completionDecision:null,completionOutcome:null}] : []), ...reports.rows.map((r: any) => ({ source: r.source,
        status: r.reporter === (r.source === 'student' ? studentId : b.tutorId) ? r.review_status : 'invalid_report_binding',
        completionDecision: r.completion_decision, completionOutcome: r.completion_outcome }))] };
    // This is a fresh eligibility read, never a proof, durable finalization or dispatch authorization.
    const assessment = assessLessonOutcome(input);
    const evidenceDigest = createHash('sha256').update(JSON.stringify({ bookingId, studentId, tutorId: b.tutorId,
      policy: assessment.policy, input })).digest('hex');
    return { assessment, evidenceDigest, hasReports: hasGraphReport || input.reports.length > 0 };
  }
  async get(bookingId: string) {
    const { assessment, evidenceDigest } = await this.inspect(bookingId);
    const session = getDriver().session();
    try {
      const result = await session.run('MATCH (r:LessonOutcomeProofRequest {bookingId:$bookingId}) RETURN r', { bookingId });
      const r = result.records[0]?.get('r').properties;
      return { ...assessment, proofRequest: r ? { id: r.id, requestedAt: r.requestedAt,
        phase: r.evidenceDigest === evidenceDigest && assessment.state === 'eligible' ? 'awaiting_prover' as const : 'needs_reassessment' as const } : null };
    } finally { await session.close(); }
  }
}

export const lessonOutcomeService = new LessonOutcomeService();
