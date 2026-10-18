import { query } from '../db/postgres';
import { tutorStudentIssueLabel, validateTutorStudentIssue, type TutorStudentIssue } from '../utils/tutorStudentIssues';
import { ensureIssueReviewColumns, reviewFields } from './lessonIssueReview.service';

export type TroubleDuration = 'up_to_ten' | 'over_ten';
export type TroubleReason = 'connection' | 'audio' | 'hardware' | 'emergency' | 'power' | 'student';

export interface LessonTroubleWindow {
  startsAt: string;
  endsAt: string;
}

export interface LessonTroubleReport {
  id: string;
  bookingId: string;
  tutorId: string;
  duration: TroubleDuration;
  reason: TroubleReason;
  studentIssue: TutorStudentIssue | null;
  studentIssueLabel: string | null;
  createdAt: string;
  status?: string;
  resolution?: string;
  ticketTransactionId?: string | null;
  attendanceCorrection?: string | null;
}

export const getLessonTroubleWindow = (slotDate: string, slotTime: string, durationMinutes: number): LessonTroubleWindow => {
  const time = /^(1[0-2]|[1-9]):([0-5]\d) (AM|PM)$/.exec(slotTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate) || !time || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error('Invalid lesson schedule');
  }

  const hour = Number(time[1]) % 12 + (time[3] === 'PM' ? 12 : 0);
  const startsAtMs = Date.parse(`${slotDate}T${String(hour).padStart(2, '0')}:${time[2]}:00+08:00`);
  if (!Number.isFinite(startsAtMs)) throw new Error('Invalid lesson schedule');

  return {
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(startsAtMs + durationMinutes * 60_000).toISOString()
  };
};

export const isLessonTroubleWindowOpen = (window: LessonTroubleWindow, nowMs = Date.now()): boolean =>
  nowMs >= Date.parse(window.startsAt) && nowMs < Date.parse(window.endsAt);

export class LessonTroubleReportService {
  private schemaReady: Promise<void> | null = null;

  async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = query(`
        CREATE TABLE IF NOT EXISTS lesson_trouble_reports (
          id TEXT PRIMARY KEY,
          booking_id TEXT NOT NULL UNIQUE,
          tutor_id TEXT NOT NULL,
          duration TEXT NOT NULL CHECK (duration IN ('up_to_ten', 'over_ten')),
          reason TEXT NOT NULL CHECK (reason IN ('connection', 'audio', 'hardware', 'emergency', 'power', 'student')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).then(() => query('ALTER TABLE lesson_trouble_reports ADD COLUMN IF NOT EXISTS student_issue TEXT'))
        .then(() => ensureIssueReviewColumns('lesson_trouble_reports')).catch(error => {
        this.schemaReady = null;
        throw error;
      });
    }
    await this.schemaReady;
  }

  async getByBooking(bookingId: string): Promise<LessonTroubleReport | null> {
    await this.ensureSchema();
    const result = await query(`
      SELECT *
      FROM lesson_trouble_reports WHERE booking_id = $1
    `, [bookingId]);
    return result.rows[0] ? this.mapReport(result.rows[0]) : null;
  }

  async create(bookingId: string, tutorId: string, duration: TroubleDuration, reason: TroubleReason, studentIssue?: TutorStudentIssue): Promise<LessonTroubleReport | null> {
    validateTutorStudentIssue(reason, studentIssue);
    await this.ensureSchema();
    const result = await query(`
      INSERT INTO lesson_trouble_reports (id, booking_id, tutor_id, duration, reason, student_issue)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (booking_id) DO NOTHING
      RETURNING *
    `, [crypto.randomUUID(), bookingId, tutorId, duration, reason, studentIssue ?? null]);
    return result.rows[0] ? this.mapReport(result.rows[0]) : null;
  }

  private mapReport(row: any): LessonTroubleReport {
    return {
      id: row.id,
      bookingId: row.booking_id,
      tutorId: row.tutor_id,
      duration: row.duration,
      reason: row.reason,
      studentIssue: row.student_issue || null,
      studentIssueLabel: tutorStudentIssueLabel(row.student_issue),
      createdAt: new Date(row.created_at).toISOString(),
      ...reviewFields(row)
    };
  }
}
