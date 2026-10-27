import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getDriver } from '../../db/memgraph';
import { query } from '../../db/postgres';
import { SessionService } from '../session.services/session.service';
import { LessonTroubleReportService } from '../lessonTroubleReport.service';
import { StudentLessonIssueReportService } from '../studentLessonIssueReport.service';
import { evidenceFields, type EvidenceField, type LessonEvidenceRecord, type LessonPrivacyRole, type SignedLessonEvidence } from '../../../../shared/lessonPrivacy';
import { LessonPrivacyCrypto } from './crypto';
import { LessonPrivacyStore, type PrivateLessonRow } from './store';
import { attendanceClaims, LessonPrivacyError, selectedFields, type PresenceInterval } from './policy';

const iso = (value: any): string => value?.toStandardDate ? value.toStandardDate().toISOString() : new Date(value).toISOString();
export class LessonPrivacyService {
  constructor(private store = new LessonPrivacyStore(), private crypto = new LessonPrivacyCrypto(), private now = () => Date.now()) {}
  private async booking(id: string) {
    const graph = getDriver().session();
    try {
      const row = (await graph.run(`MATCH (b:Booking {bookingId:$id})-[:BOOKED_BY]->(s:Student)
        RETURN b,s.id AS studentId`, { id })).records[0];
      if (!row) throw new LessonPrivacyError('Lesson not found.', 404);
      const b = row.get('b').properties;
      return { id, studentId: row.get('studentId') as string, tutorId: b.tutorId as string,
        startsAt: iso(b.slotDateTime), duration: Number(b.durationMinutes) || 25, status: b.status as string,
        cancelledAt: b.cancelledAt ? iso(b.cancelledAt) : null, sessionId: b.sessionId || id };
    } finally { await graph.close(); }
  }
  private async owned(id: string, actor: string, role: LessonPrivacyRole) {
    const b = await this.booking(id);
    if ((role === 'student' ? b.studentId : b.tutorId) !== actor) throw new LessonPrivacyError('Lesson not found.', 404);
    return b;
  }
  private context(row: Pick<PrivateLessonRow, 'kind' | 'id' | 'owner_id' | 'owner_role' | 'booking_id'>) {
    // Preserve the AAD format so existing encrypted evidence remains readable.
    return JSON.stringify([row.kind, row.owner_role, row.owner_id, row.booking_id,
      row.id, null]);
  }
  private evidence(row: PrivateLessonRow): LessonEvidenceRecord {
    return { id: row.id, fields: row.fields as EvidenceField[], createdAt: iso(row.created_at), expiresAt: iso(row.expires_at),
      sharedWithSupport: row.support_shared && Date.parse(iso(row.expires_at)) > this.now(),
      envelope: this.crypto.open<SignedLessonEvidence>(row.ciphertext, this.context(row)) };
  }
  private async report(booking: string, owner: string, role: LessonPrivacyRole) {
    if (role === 'student') await new StudentLessonIssueReportService().ensureSchema();
    else await new LessonTroubleReportService().ensureSchema();
    const table = role === 'student' ? 'student_lesson_issue_reports' : 'lesson_trouble_reports';
    const column = role === 'student' ? 'student_id' : 'tutor_id';
    return (await query(`SELECT id FROM ${table} WHERE booking_id=$1 AND ${column}=$2 LIMIT 1`, [booking, owner])).rows[0];
  }
  async evidenceOptions(booking: string, actor: string, role: LessonPrivacyRole) {
    const b = await this.owned(booking, actor, role);
    if (!this.crypto.evidenceEnabled) return { enabled: false, canCreate: false, canShare: false, records: [] };
    return { enabled: true, canCreate: Date.parse(b.startsAt)+b.duration*60000 <= this.now() || b.status === 'cancelled',
      canShare: !!await this.report(booking, actor, role),
      records: (await this.store.owned(booking, actor, role)).map(row => this.evidence(row)) };
  }
  async createEvidence(booking: string, actor: string, role: LessonPrivacyRole, input: { fields: EvidenceField[] }) {
    if (!this.crypto.evidenceEnabled) throw new LessonPrivacyError('Private lesson evidence is not configured.', 503);
    const b = await this.owned(booking, actor, role), start = Date.parse(b.startsAt), now = this.now();
    const end = start+b.duration*60000;
    if (end > now && b.status !== 'cancelled') throw new LessonPrivacyError('Create attendance evidence after the lesson ends.');
    const existing = await this.store.owned(booking, actor, role);
    if (existing.length >= 20) throw new LessonPrivacyError('The evidence limit for this lesson has been reached.', 409);
    const fields = selectedFields(input.fields, evidenceFields);
    let rows: PresenceInterval[] = [];
    if (fields.some(field => field !== 'cancellation')) {
      await new SessionService().ensurePresenceSchema();
      const observed = await query(`SELECT user_type, joined_at, last_seen_at, left_at FROM session_participants
        WHERE session_id=$1 AND ((user_type='student' AND user_id=$2) OR (user_type='tutor' AND user_id=$3))
          AND joined_at<$4::timestamptz ORDER BY joined_at LIMIT 10001`, [b.sessionId, b.studentId, b.tutorId, new Date(Math.min(end,now))]);
      if (observed.rows.length > 10000) throw new LessonPrivacyError('Too many attendance records; contact support.', 409);
      rows = observed.rows.map((r: any) => ({ role: r.user_type, joinedAt: iso(r.joined_at),
        lastSeenAt: r.last_seen_at ? iso(r.last_seen_at) : null, leftAt: r.left_at ? iso(r.left_at) : null }));
    }
    const id = randomUUID(), threshold = Math.min(15,b.duration);
    const envelope = this.crypto.sign({ schema: 'fluentxverse.lesson-evidence.v1', id,
      bookingCommitment: createHash('sha256').update(randomBytes(32)).update(booking).digest('hex'),
      issuedAt: new Date(now).toISOString(), thresholdMinutes: threshold, source: 'platform_room_presence_records',
      claims: attendanceClaims(rows, start, end, threshold, fields, b.status, b.cancelledAt) });
    const row = { id, kind: 'evidence' as const, owner_id: actor, owner_role: role, booking_id: booking,
      fields, expires_at: new Date(now+30*86400000), ciphertext: '' };
    row.ciphertext = this.crypto.seal(envelope, this.context(row));
    return this.evidence(await this.store.save(row));
  }
  async supportConsent(booking: string, actor: string, role: LessonPrivacyRole, id: string, shared: boolean) {
    await this.owned(booking, actor, role);
    if (shared && !await this.report(booking, actor, role)) throw new LessonPrivacyError('Submit your lesson issue report before sharing evidence.');
    await this.store.setSupport(id, booking, actor, role, shared);
  }
  async supportEvidence(role: LessonPrivacyRole, reportId: string, admin: string) {
    const table = role === 'student' ? 'student_lesson_issue_reports' : 'lesson_trouble_reports';
    const column = role === 'student' ? 'student_id' : 'tutor_id';
    if (role === 'student') await new StudentLessonIssueReportService().ensureSchema(); else await new LessonTroubleReportService().ensureSchema();
    const r = (await query(`SELECT booking_id, ${column} AS owner_id FROM ${table} WHERE id=$1`, [reportId])).rows[0];
    if (!r) throw new LessonPrivacyError('Report not found.', 404);
    await this.owned(r.booking_id, r.owner_id, role);
    return (await this.store.support(r.booking_id, r.owner_id, role, admin)).map(row => this.evidence(row));
  }
  issuer() { return this.crypto.issuer(); }
}
export const lessonPrivacyService = new LessonPrivacyService();
