import { db } from '../../db/postgres';
import type { MobileSession, MobileSessionStore } from './mobileAuth.service';

const fromRow = (row: Record<string, any>): MobileSession => ({
  id: row.id, userId: row.user_id, createdAt: Number(row.created_at), credentialVersion: Number(row.credential_version),
  expiresAt: Number(row.expires_at), revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
});

export class PostgresMobileSessionStore implements MobileSessionStore {
  constructor(private readonly sql: typeof db = db) {}
  private ready: Promise<void> | null = null;

  private ensureSchema(): Promise<void> {
    if (!this.ready) this.ready = (async () => {
      await this.sql`CREATE TABLE IF NOT EXISTS mobile_student_sessions (
        id UUID PRIMARY KEY, user_id TEXT NOT NULL, created_at BIGINT NOT NULL,
        credential_version BIGINT NOT NULL,
        expires_at BIGINT NOT NULL, revoked_at BIGINT
      )`;
      await this.sql`CREATE TABLE IF NOT EXISTS mobile_student_refresh_tokens (
        token_hash CHAR(64) PRIMARY KEY,
        session_id UUID NOT NULL REFERENCES mobile_student_sessions(id) ON DELETE CASCADE,
        used_at BIGINT
      )`;
      await this.sql`CREATE INDEX IF NOT EXISTS mobile_student_session_expiry ON mobile_student_sessions(expires_at)`;
      await this.sql`CREATE INDEX IF NOT EXISTS mobile_student_refresh_session ON mobile_student_refresh_tokens(session_id)`;
    })().catch(error => { this.ready = null; throw error; });
    return this.ready;
  }

  async create(session: MobileSession, tokenHash: string): Promise<void> {
    await this.ensureSchema();
    await this.sql.begin(async tx => {
      await tx`INSERT INTO mobile_student_sessions(id,user_id,created_at,credential_version,expires_at)
        VALUES (${session.id},${session.userId},${session.createdAt},${session.credentialVersion},${session.expiresAt})`;
      await tx`INSERT INTO mobile_student_refresh_tokens(token_hash,session_id) VALUES (${tokenHash},${session.id})`;
    });
  }

  async find(id: string): Promise<MobileSession | null> {
    await this.ensureSchema();
    const rows = await this.sql`SELECT * FROM mobile_student_sessions WHERE id = ${id}`;
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async rotate(hash: string, nextHash: string, now: number): Promise<MobileSession | null> {
    await this.ensureSchema();
    return this.sql.begin(async tx => {
      const rows = await tx`SELECT s.*, t.used_at FROM mobile_student_sessions s
        JOIN mobile_student_refresh_tokens t ON t.session_id = s.id
        WHERE t.token_hash = ${hash} FOR UPDATE OF s, t`;
      const row = rows[0];
      if (!row || row.revoked_at !== null || Number(row.expires_at) <= now) return null;
      if (row.used_at !== null) {
        // Commit revocation before reporting reuse, including concurrent refresh attempts.
        await tx`UPDATE mobile_student_sessions SET revoked_at = ${now} WHERE id = ${row.id}`;
        return null;
      }
      await tx`UPDATE mobile_student_refresh_tokens SET used_at = ${now} WHERE token_hash = ${hash}`;
      await tx`INSERT INTO mobile_student_refresh_tokens(token_hash,session_id) VALUES (${nextHash},${row.id})`;
      return fromRow(row);
    });
  }

  async revoke(id: string, now: number): Promise<void> {
    await this.ensureSchema();
    await this.sql`UPDATE mobile_student_sessions SET revoked_at = COALESCE(revoked_at, ${now}) WHERE id = ${id}`;
  }

  async revokeByRefresh(hash: string, now: number): Promise<void> {
    await this.ensureSchema();
    await this.sql`UPDATE mobile_student_sessions SET revoked_at = COALESCE(revoked_at, ${now}) WHERE id IN (
      SELECT session_id FROM mobile_student_refresh_tokens WHERE token_hash = ${hash}
    )`;
  }
}
