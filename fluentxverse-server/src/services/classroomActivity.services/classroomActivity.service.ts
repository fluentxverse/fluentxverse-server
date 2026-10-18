import { db, query } from '../../db/postgres';

export type ClassroomActivityUserType = 'tutor' | 'student';
export type ClassroomActivityEventType = 'entered' | 'left' | 'lesson_ended';

export interface ClassroomActivityLog {
  id: string;
  sessionId: string;
  userId: string;
  userType: ClassroomActivityUserType;
  eventType: ClassroomActivityEventType;
  message: string;
  createdAt: string;
}

export interface LogClassroomActivityInput {
  sessionId: string;
  userId: string;
  userType: ClassroomActivityUserType;
  eventType: ClassroomActivityEventType;
  message?: string;
}

const generateActivityId = () => `clog-${crypto.randomUUID()}`;

const buildMessage = (userType: ClassroomActivityUserType, eventType: ClassroomActivityEventType) => {
  const actor = userType === 'tutor' ? 'Tutor' : 'Student';

  if (eventType === 'entered') {
    return `${actor} entered the lesson room.`;
  }

  if (eventType === 'left') {
    return `${actor} left the lesson room.`;
  }

  return `${actor} ended the lesson.`;
};

export class ClassroomActivityService {
  private static initPromise: Promise<void> | null = null;

  async ensureTable(): Promise<void> {
    if (!ClassroomActivityService.initPromise) {
      ClassroomActivityService.initPromise = (async () => {
        await db`
          CREATE TABLE IF NOT EXISTS classroom_activity_logs (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            user_type TEXT NOT NULL CHECK (user_type IN ('tutor', 'student')),
            event_type TEXT NOT NULL CHECK (event_type IN ('entered', 'left', 'lesson_ended')),
            message TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `;

        await db`
          CREATE INDEX IF NOT EXISTS classroom_activity_logs_session_created_idx
          ON classroom_activity_logs (session_id, created_at DESC)
        `;
        await query('ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ');
      })().catch(error => { ClassroomActivityService.initPromise = null; throw error; });
    }

    await ClassroomActivityService.initPromise;
  }

  private mapRow(row: any): ClassroomActivityLog {
    return {
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      userType: row.user_type,
      eventType: row.event_type,
      message: row.message,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
  }

  async log(input: LogClassroomActivityInput): Promise<ClassroomActivityLog> {
    await this.ensureTable();

    const id = generateActivityId();
    const message = input.message || buildMessage(input.userType, input.eventType);

    const result = await query(
      `INSERT INTO classroom_activity_logs (id, session_id, user_id, user_type, event_type, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, input.sessionId, input.userId, input.userType, input.eventType, message]
    );

    return this.mapRow(result.rows[0]);
  }

  async getSessionActivity(sessionId: string, limit = 100): Promise<ClassroomActivityLog[]> {
    await this.ensureTable();

    const result = await query(
      `SELECT *
       FROM classroom_activity_logs
       WHERE session_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [sessionId, limit]
    );

    return result.rows.map((row: any) => this.mapRow(row));
  }

  async hasTutorEnteredForLesson(sessionId: string, tutorId: string, start: Date, deadline: Date): Promise<boolean> {
    await this.ensureTable();
    const result = await query(
      `SELECT 1 FROM classroom_activity_logs entered
       WHERE entered.session_id = $1 AND entered.user_id = $2 AND entered.user_type = 'tutor'
         AND entered.event_type = 'entered' AND entered.created_at <= $4
         AND entered.created_at >= $3::timestamptz - INTERVAL '5 minutes'
         AND (entered.created_at >= $3 OR (
           EXISTS (SELECT 1 FROM classroom_activity_logs left_event
             WHERE left_event.session_id = $1 AND left_event.user_id = $2
               AND left_event.user_type = 'tutor' AND left_event.event_type = 'left'
               AND left_event.created_at >= $3 AND left_event.created_at <= $4)
           AND NOT EXISTS (
           SELECT 1 FROM classroom_activity_logs left_event
           WHERE left_event.session_id = $1 AND left_event.user_id = $2
             AND left_event.user_type = 'tutor' AND left_event.event_type = 'left'
             AND left_event.created_at > entered.created_at AND left_event.created_at < $3
         )))
       UNION ALL
       SELECT 1 FROM session_participants
       WHERE session_id = $1 AND user_id = $2 AND user_type = 'tutor'
         AND joined_at <= $4 AND COALESCE(last_seen_at, joined_at) >= $3
       LIMIT 1`,
      [sessionId, tutorId, start, deadline]
    );
    return result.rows.length > 0;
  }

  async getTutorPresenceForLesson(sessionId: string, tutorId: string, start: Date, now: Date) {
    await this.ensureTable();
    // Active participants take precedence; stale socket departures must not hide a reconnect.
    const result = await query(`
      SELECT event_type, created_at, active FROM (
        SELECT event_type, created_at, false AS active FROM classroom_activity_logs
        WHERE session_id = $1 AND user_id = $2 AND user_type = 'tutor'
          AND event_type IN ('entered', 'left') AND created_at BETWEEN $3 AND $4
        UNION ALL
        SELECT 'entered', joined_at, true FROM session_participants
        WHERE session_id = $1 AND user_id = $2 AND user_type = 'tutor' AND is_active = true AND joined_at <= $4
          AND COALESCE(last_seen_at, joined_at) >= $4::timestamptz - INTERVAL '20 seconds'
        UNION ALL
        SELECT 'left', COALESCE(last_seen_at, joined_at), false FROM session_participants
        WHERE session_id = $1 AND user_id = $2 AND user_type = 'tutor' AND is_active = true
          AND COALESCE(last_seen_at, joined_at) < $4::timestamptz - INTERVAL '20 seconds'
        UNION ALL
        SELECT 'left', left_at, false FROM session_participants
        WHERE session_id = $1 AND user_id = $2 AND user_type = 'tutor' AND is_active = false AND left_at BETWEEN $3 AND $4
      ) events ORDER BY active DESC, created_at DESC, event_type ASC LIMIT 1`,
      [sessionId, tutorId, new Date(start.getTime() - 5 * 60000), now]);
    const event = result.rows[0];
    const leftAt = event && !event.active ? new Date(event.created_at).getTime() : null;
    return { hasJoined: Boolean(event && (event.active || (leftAt !== null && leftAt >= start.getTime()))),
      leftAt: leftAt !== null && leftAt >= start.getTime() ? leftAt : null };
  }
}
