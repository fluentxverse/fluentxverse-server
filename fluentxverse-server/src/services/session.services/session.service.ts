import { db, query } from '../../db/postgres';
import { ClassroomActivityService } from '../classroomActivity.services/classroomActivity.service';

export interface Session {
  id: string;
  tutor_id: string;
  student_id: string;
  status: 'active' | 'completed' | 'cancelled';
  start_time: Date;
  end_time: Date | null;
  duration_minutes: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface SessionParticipant {
  id: string;
  session_id: string;
  user_id: string;
  user_type: 'tutor' | 'student';
  socket_id: string;
  is_active: boolean;
  joined_at: Date;
  left_at: Date | null;
  last_seen_at: Date | null;
}

export interface AddParticipantData {
  sessionId: string;
  userId: string;
  socketId: string;
  userType: 'tutor' | 'student';
}

export class SessionService {
  private static presenceSchema: Promise<void> | null = null;

  async ensurePresenceSchema(): Promise<void> {
    if (!SessionService.presenceSchema) {
      SessionService.presenceSchema = (async () => {
        await query('ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ');
        await query('ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true');
        await query(`ALTER TABLE session_participants
          DROP CONSTRAINT IF EXISTS session_participants_session_id_user_id_is_active_key,
          DROP CONSTRAINT IF EXISTS session_participants_session_id_user_id_key`);
        await query(`CREATE UNIQUE INDEX IF NOT EXISTS session_participants_one_active_user_idx
          ON session_participants (session_id, user_id) WHERE is_active = true`);
      })().catch(error => { SessionService.presenceSchema = null; throw error; });
    }
    await SessionService.presenceSchema;
  }

  async reconcilePresence(liveSocketIds: string[], sessionId?: string, checkedAt = new Date()) {
    await this.ensurePresenceSchema();
    await new ClassroomActivityService().ensureTable();
    await query(`UPDATE session_participants SET last_seen_at = NOW()
      WHERE is_active = true AND socket_id = ANY($1::text[])
        AND ($2::text IS NULL OR session_id = $2)`, [db.array(liveSocketIds, 'TEXT'), sessionId || null]);
    // Persist the last verified presence, not the restart time, as the departure.
    const result = await query(`WITH departed AS (
      UPDATE session_participants SET is_active = false, left_at = COALESCE(last_seen_at, joined_at)
      WHERE is_active = true AND (socket_id IS NULL OR NOT (socket_id = ANY($1::text[])))
        AND ($2::text IS NULL OR session_id = $2)
        AND joined_at <= $3::timestamptz
      RETURNING id, session_id, user_id, user_type, left_at
    ) INSERT INTO classroom_activity_logs (id, session_id, user_id, user_type, event_type, message, created_at)
      SELECT 'clog-disconnect-' || id::text || '-' || EXTRACT(EPOCH FROM left_at)::text,
        session_id, user_id, user_type, 'left', 'Connection to the lesson room was lost.', left_at
      FROM departed RETURNING *`, [db.array(liveSocketIds, 'TEXT'), sessionId || null, checkedAt]);
    return result.rows;
  }
  async createSession(tutorId: string, studentId: string): Promise<Session> {
    const result = await query(
      `INSERT INTO sessions (tutor_id, student_id, status, start_time)
       VALUES ($1, $2, 'active', NOW())
       RETURNING *`,
      [tutorId, studentId]
    );

    return result.rows[0];
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const result = await query(
      `SELECT * FROM sessions WHERE id = $1`,
      [sessionId]
    );

    return result.rows[0] || null;
  }

  async endSession(sessionId: string): Promise<Session | null> {
    const result = await query(
      `UPDATE sessions
       SET status = 'completed',
           end_time = NOW(),
           duration_minutes = EXTRACT(EPOCH FROM (NOW() - start_time)) / 60,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [sessionId]
    );

    return result.rows[0] || null;
  }

  async addParticipant(data: AddParticipantData): Promise<SessionParticipant> {
    await this.ensurePresenceSchema();
    const { sessionId, userId, socketId, userType } = data;

    // Replace the active connection without deleting historical presence evidence.
    await query(
      `UPDATE session_participants
       SET is_active = false, left_at = NOW()
       WHERE session_id = $1
         AND user_id = $2
         AND is_active = true
       RETURNING id`,
      [sessionId, userId]
    );

    // First, deactivate any existing active participants of the same type in this session
    // This handles reconnections where user ID might change
    await query(
      `UPDATE session_participants
       SET is_active = false, left_at = NOW()
       WHERE session_id = $1 AND user_type = $2 AND is_active = true
       RETURNING id`,
      [sessionId, userType]
    );

    // Add new participant record
    const result = await query(
      `INSERT INTO session_participants (session_id, user_id, user_type, socket_id, is_active, last_seen_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       RETURNING *`,
      [sessionId, userId, userType, socketId]
    );

    return result.rows[0];
  }

  async removeParticipant(sessionId: string, userId: string, userType: 'tutor' | 'student', socketId: string): Promise<boolean> {
    const result = await query(
      `UPDATE session_participants
       SET is_active = false, left_at = NOW()
       WHERE session_id = $1 AND user_id = $2 AND user_type = $3
         AND socket_id = $4 AND is_active = true
       RETURNING id`,
      [sessionId, userId, userType, socketId]
    );

    return (result.rowCount || 0) > 0;
  }

  async getSessionParticipants(sessionId: string): Promise<SessionParticipant[]> {
    const result = await query(
      `SELECT * FROM session_participants
       WHERE session_id = $1 AND is_active = true
       ORDER BY joined_at ASC`,
      [sessionId]
    );

    return result.rows;
  }

  async getUserActiveSessions(userId: string): Promise<Session[]> {
    const result = await query(
      `SELECT s.* FROM sessions s
       JOIN session_participants sp ON s.id = sp.session_id
       WHERE sp.user_id = $1 AND sp.is_active = true AND s.status = 'active'
       ORDER BY s.start_time DESC`,
      [userId]
    );

    return result.rows;
  }
}
