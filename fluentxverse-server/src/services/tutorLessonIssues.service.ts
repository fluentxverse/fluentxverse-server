import { getDriver } from '../db/memgraph';
import { query } from '../db/postgres';
import { performanceWindow } from '../utils/tutorPerformance';
import { studentTutorIssueLabel } from '../utils/studentTutorIssues';
import { tutorStudentIssueLabel } from '../utils/tutorStudentIssues';
import { LessonTroubleReportService } from './lessonTroubleReport.service';
import { StudentLessonIssueReportService } from './studentLessonIssueReport.service';

const PAGE_SIZE = 20;
const reasons: Record<string, string> = {
  connection: 'Connection problems', audio: 'Audio problems', hardware: 'Device problems',
  emergency: 'Emergency', power: 'Power outage', student: 'Student-related issue',
  tutor: 'Tutor-related issue', material: 'Learning material issue', other: 'Other issue',
};
type Booking = { bookingId: string; studentId: string | null; studentName: string; startsAt: string | null };

export function issueListOptions(period = 'month', month?: string, direction = 'sent', status = 'all', page = 1, now = Date.now()) {
  const window = performanceWindow(period, month, now);
  if (!['sent', 'received'].includes(direction)) throw new Error('Invalid issue direction');
  if (!['all', 'submitted', 'under_review', 'resolved'].includes(status)) throw new Error('Invalid issue status');
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error('Invalid issue page');
  return { window, direction, status, page };
}

function iso(value: any): string | null {
  const date = value?.toStandardDate ? value.toStandardDate() : value;
  if (!date || !Number.isFinite(Date.parse(String(date)))) return null;
  return new Date(date).toISOString();
}

export function issueBookingInPeriod(startsAt: string | null, window: ReturnType<typeof performanceWindow>) {
  if (window.period === 'all') return true;
  const timestamp = Date.parse(startsAt || '');
  return Number.isFinite(timestamp) && (!window.from || timestamp >= Date.parse(window.from))
    && (!window.to || timestamp < Date.parse(window.to));
}

export function publicTutorIssue(row: any, booking: Booking) {
  return {
    id: String(row.id), bookingId: booking.bookingId, studentName: booking.studentName, startsAt: booking.startsAt,
    direction: row.direction, reason: row.reason, reasonLabel: reasons[row.reason] || 'Other issue',
    issueLabel: row.direction === 'sent' ? tutorStudentIssueLabel(row.student_issue) : studentTutorIssueLabel(row.tutor_issue),
    duration: row.duration, details: row.direction === 'received' ? String(row.details || '') : '',
    status: row.review_status, resolution: String(row.resolution || ''),
    createdAt: iso(row.created_at), reviewedAt: iso(row.reviewed_at),
  };
}

export class TutorLessonIssuesService {
  private tutorReports = new LessonTroubleReportService();
  private studentReports = new StudentLessonIssueReportService();

  async list(tutorId: string, period = 'month', month?: string, direction = 'sent', status = 'all', page = 1) {
    const now = Date.now();
    const options = issueListOptions(period, month, direction, status, page, now);
    const session = getDriver().session();
    let bookings: Booking[];
    try {
      const result = await session.run(`MATCH (b:Booking {tutorId: $tutorId})
        OPTIONAL MATCH (b)-[:BOOKED_BY]->(s:Student)
        RETURN b.bookingId AS bookingId, s.id AS studentId, b.slotDateTime AS startsAt,
          coalesce(s.givenName, s.firstName, 'Student') AS first, coalesce(s.familyName, s.lastName, '') AS last`, { tutorId });
      bookings = result.records.map(row => ({ bookingId: row.get('bookingId'), studentId: row.get('studentId'),
        studentName: `${row.get('first')} ${row.get('last')}`.trim(), startsAt: iso(row.get('startsAt')) }))
        .filter(booking => booking.bookingId && issueBookingInPeriod(booking.startsAt, options.window));
    } finally { await session.close(); }

    const byBooking = new Map(bookings.map(booking => [booking.bookingId, booking]));
    const empty = { summary: { sent: 0, received: 0 }, statusCounts: { submitted: 0, under_review: 0, resolved: 0 }, total: 0, items: [] as any[] };
    let result = empty;
    if (bookings.length) {
      await this.tutorReports.ensureSchema();
      await this.studentReports.ensureSchema();
      // Join only graph-authorized bookings; received reports must also belong to that booking's student.
      // Explicit columns keep internal case notes, assignees and review history out of the tutor response.
      const rows = await query(`WITH owned AS (
          SELECT * FROM jsonb_to_recordset($2::jsonb) AS b(booking_id TEXT, student_id TEXT)
        ), reports AS (
          SELECT r.id, r.booking_id, 'sent' AS direction, r.reason, r.duration, '' AS details,
            r.student_issue, NULL::TEXT AS tutor_issue, r.created_at, r.resolution, r.reviewed_at,
            CASE WHEN r.review_status IN ('submitted', 'under_review', 'resolved') THEN r.review_status ELSE 'submitted' END AS review_status
          FROM lesson_trouble_reports r JOIN owned b ON b.booking_id = r.booking_id WHERE r.tutor_id = $1
          UNION ALL
          SELECT r.id, r.booking_id, 'received' AS direction, r.reason, r.duration, r.details,
            NULL::TEXT AS student_issue, r.tutor_issue, r.created_at, r.resolution, r.reviewed_at,
            CASE WHEN r.review_status IN ('submitted', 'under_review', 'resolved') THEN r.review_status ELSE 'submitted' END AS review_status
          FROM student_lesson_issue_reports r JOIN owned b ON b.booking_id = r.booking_id AND b.student_id = r.student_id
        ), selected AS (SELECT * FROM reports WHERE direction = $3), filtered AS (
          SELECT * FROM selected WHERE $4 = 'all' OR review_status = $4
        ) SELECT jsonb_build_object(
          'summary', (SELECT jsonb_build_object('sent', COUNT(*) FILTER (WHERE direction = 'sent'),
            'received', COUNT(*) FILTER (WHERE direction = 'received')) FROM reports),
          'statusCounts', (SELECT jsonb_build_object('submitted', COUNT(*) FILTER (WHERE review_status = 'submitted'),
            'under_review', COUNT(*) FILTER (WHERE review_status = 'under_review'),
            'resolved', COUNT(*) FILTER (WHERE review_status = 'resolved')) FROM selected),
          'total', (SELECT COUNT(*) FROM filtered),
          'items', COALESCE((SELECT jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC, r.id DESC)
            FROM (SELECT * FROM filtered ORDER BY created_at DESC, id DESC LIMIT $5 OFFSET $6) r), '[]'::jsonb)
        ) AS data`, [tutorId, [...byBooking.values()].map(b => ({ booking_id: b.bookingId, student_id: b.studentId })),
          direction, status, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
      result = rows.rows[0].data;
    }
    return { period: options.window, timezone: 'Asia/Manila', generatedAt: new Date(now).toISOString(), direction, status,
      summary: result.summary, statusCounts: result.statusCounts, total: result.total,
      items: result.items.map(row => publicTutorIssue(row, byBooking.get(row.booking_id)!)),
      page, pageSize: PAGE_SIZE, totalPages: Math.ceil(result.total / PAGE_SIZE) };
  }
}
export const tutorLessonIssuesService = new TutorLessonIssuesService();
