import { db, query } from '../../db/postgres';
import { LessonPrivacyError } from './policy';

export interface PrivateLessonRow {
  id: string; kind: 'evidence'; owner_id: string; owner_role: 'student' | 'tutor'; booking_id: string;
  fields: string[]; ciphertext: string; created_at: Date; expires_at: Date; support_shared: boolean;
}
export class LessonPrivacyStore {
  private schema: Promise<void> | null = null;
  async ensure() {
    if (!this.schema) this.schema = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS lesson_privacy_records (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind = 'evidence'),
        owner_id TEXT NOT NULL, owner_role TEXT NOT NULL CHECK (owner_role IN ('student','tutor')),
        booking_id TEXT NOT NULL,
        fields JSONB NOT NULL, ciphertext TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL, support_shared BOOLEAN NOT NULL DEFAULT false)`);
      await query(`CREATE INDEX IF NOT EXISTS lesson_privacy_owner ON lesson_privacy_records (owner_id, owner_role, booking_id)`);
      await query(`CREATE INDEX IF NOT EXISTS lesson_privacy_expiry ON lesson_privacy_records (expires_at) WHERE kind='evidence'`);
      await query(`CREATE TABLE IF NOT EXISTS lesson_privacy_audit (
        id BIGSERIAL PRIMARY KEY, record_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        action TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    })().catch(error => { this.schema = null; throw error; });
    await this.schema;
  }
  private async audit(sql: any, id: string, actor: string, action: string) {
    await sql.unsafe('INSERT INTO lesson_privacy_audit (record_id, actor_id, action) VALUES ($1,$2,$3)', [id, actor, action]);
  }
  async save(row: Omit<PrivateLessonRow, 'created_at' | 'support_shared'>) {
    await this.ensure();
    return db.begin(async sql => {
      const result = await sql.unsafe(`INSERT INTO lesson_privacy_records
        (id, kind, owner_id, owner_role, booking_id, fields, ciphertext, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
        RETURNING *`, [row.id, row.kind, row.owner_id, row.owner_role, row.booking_id,
        JSON.stringify(row.fields), row.ciphertext, row.expires_at]);
      await this.audit(sql, result[0].id, row.owner_id, 'evidence_created');
      return result[0] as PrivateLessonRow;
    });
  }
  async owned(bookingId: string, owner: string, role: string): Promise<PrivateLessonRow[]> {
    await this.ensure();
    return (await query(`SELECT * FROM lesson_privacy_records WHERE booking_id=$1 AND owner_id=$2
      AND owner_role=$3 AND kind='evidence' ORDER BY created_at DESC LIMIT 50`, [bookingId, owner, role])).rows as PrivateLessonRow[];
  }
  async setSupport(id: string, booking: string, owner: string, role: string, shared: boolean) {
    await this.ensure();
    await db.begin(async sql => {
      const rows = await sql.unsafe(`UPDATE lesson_privacy_records SET support_shared=$5
        WHERE id=$1 AND booking_id=$2 AND owner_id=$3 AND owner_role=$4 AND kind='evidence'
          AND (expires_at>NOW() OR $5=false) RETURNING id`, [id, booking, owner, role, shared]);
      if (!rows.length) throw new LessonPrivacyError('Evidence not found or expired.', 404);
      await this.audit(sql, id, owner, shared ? 'support_consented' : 'support_revoked');
    });
  }
  async support(booking: string, owner: string, role: string, admin: string): Promise<PrivateLessonRow[]> {
    await this.ensure();
    return db.begin(async sql => {
      const rows = await sql.unsafe(`SELECT * FROM lesson_privacy_records WHERE kind='evidence' AND booking_id=$1
        AND owner_id=$2 AND owner_role=$3 AND support_shared=true AND expires_at>NOW()
        ORDER BY created_at DESC LIMIT 50 FOR SHARE`, [booking, owner, role]);
      for (const row of rows) await this.audit(sql, row.id, admin, 'support_read');
      return rows as PrivateLessonRow[];
    });
  }
  async purgeExpired() {
    await this.ensure();
    return db.begin(async sql => {
      const removed = await sql.unsafe(`DELETE FROM lesson_privacy_records WHERE kind='evidence' AND expires_at<=NOW() RETURNING id`);
      const audit = await sql.unsafe(`DELETE FROM lesson_privacy_audit WHERE created_at<NOW()-INTERVAL '90 days' RETURNING id`);
      return { snapshots: removed.length, auditEvents: audit.length };
    });
  }
}
