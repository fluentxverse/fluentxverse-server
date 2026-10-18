import { db } from '../db/postgres';
import { ScheduleService } from './schedule.services/schedule.service';
import { canEnterClassroom, canCommunicateInClassroom } from '../socket/classroomTiming';
import { RealtimeKitClient, opaqueMediaId, type ProviderRecording, type ClassroomRole } from './realtimekit.client';
import { PostgresMediaRoomStore, type MediaRoom } from './classroomMedia.service';
import { QaRecordingStorage, recordingRange } from './qaRecordingStorage';

export const QA_NOTICE_VERSION = 'qa-local-30d-v1';
export const QA_RETENTION_DAYS = 30;
const ACTIVE = ['INVOKED', 'RECORDING', 'PAUSED'];
type Consent = { userId: string; accepted: boolean; authority: boolean; version: string };
type ConsentRow = { role: ClassroomRole; user_id: string; accepted: boolean; authority: boolean; version: string };

export function bothRecordingConsents(consents: Consent[]) {
  return consents.length === 2 && consents.every(c => c.accepted && c.authority && c.version === QA_NOTICE_VERSION);
}

export class QaRecordingService {
  private ready?: Promise<void>;
  constructor(private client = new RealtimeKitClient(), private storage = new QaRecordingStorage(),
    private schedule = (bookingId: string, userId: string, role: ClassroomRole) => new ScheduleService().getClassroomSchedule(bookingId, userId, role)) {}
  async ensureTable() {
    this.ready ??= (async () => {
      await new PostgresMediaRoomStore().ensureTable();
      await db`CREATE TABLE IF NOT EXISTS qa_recording_consents (
        booking_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('student','tutor')),
        user_id TEXT NOT NULL, accepted BOOLEAN NOT NULL, authority BOOLEAN NOT NULL,
        version TEXT NOT NULL, acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (booking_id, role)
      )`;
      await db`CREATE TABLE IF NOT EXISTS qa_recording_control (
        booking_id TEXT PRIMARY KEY, requested_at TIMESTAMPTZ, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        attempts INTEGER NOT NULL DEFAULT 0, error TEXT
      )`;
      await db`CREATE TABLE IF NOT EXISTS qa_recordings (
        id UUID PRIMARY KEY, booking_id TEXT NOT NULL, meeting_id TEXT NOT NULL,
        provider_status TEXT NOT NULL, invoked_at TIMESTAMPTZ NOT NULL, verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL, local_status TEXT NOT NULL DEFAULT 'pending',
        byte_size BIGINT, sha256 TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), error TEXT,
        archived_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ
      )`;
      await db`CREATE INDEX IF NOT EXISTS qa_recordings_booking ON qa_recordings(booking_id, invoked_at DESC)`;
      await db`CREATE TABLE IF NOT EXISTS qa_recording_access_log (
        id BIGSERIAL PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL,
        recording_id UUID, detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    })().catch(error => { this.ready = undefined; throw error; });
    return this.ready;
  }
  enabled() { return process.env.QA_RECORDING_ENABLED === 'true'; }

  async participantState(bookingId: string, userId: string, role: ClassroomRole) {
    await this.authorize(bookingId, userId, role);
    await this.ensureTable();
    const rooms = await db`SELECT provider FROM classroom_media_rooms WHERE booking_id=${bookingId}`;
    const enabled = this.enabled() && rooms[0]?.provider === 'realtimekit';
    const consent = await db`SELECT accepted FROM qa_recording_consents WHERE booking_id=${bookingId} AND role=${role}
      AND user_id=${userId} AND version=${QA_NOTICE_VERSION}`;
    const consents = await db`SELECT accepted FROM qa_recording_consents WHERE booking_id=${bookingId} AND version=${QA_NOTICE_VERSION}` as Array<{accepted:boolean}>;
    const records = await db`SELECT provider_status, verified_at FROM qa_recordings WHERE booking_id=${bookingId} ORDER BY invoked_at DESC LIMIT 1`;
    const latest = records[0];
    let status = !enabled ? 'disabled' : consents.some(c => !c.accepted) ? 'declined' : 'waiting';
    if (latest && Date.now() - new Date(latest.verified_at).getTime() < 60_000) status = latest.provider_status.toLowerCase();
    return { enabled, version: QA_NOTICE_VERSION, retentionDays: QA_RETENTION_DAYS,
      accepted: consent[0]?.accepted ?? null, status };
  }

  private async authorize(bookingId: string, userId: string, role: ClassroomRole) {
    const schedule = await this.schedule(bookingId, userId, role);
    if (!schedule || !canEnterClassroom(schedule.startsAt, schedule.endsAt)) throw new Error('Classroom unavailable');
    return schedule;
  }

  async acknowledge(bookingId: string, userId: string, role: ClassroomRole, accepted: boolean, authority: boolean, version: string) {
    if (!this.enabled() || version !== QA_NOTICE_VERSION || (accepted && !authority)) throw new Error('Recording acknowledgement invalid');
    await this.authorize(bookingId, userId, role);
    await this.ensureTable();
    const room = await db`SELECT provider FROM classroom_media_rooms WHERE booking_id=${bookingId} AND closed=FALSE`;
    if (room[0]?.provider !== 'realtimekit') throw new Error('Recording unavailable');
    await db`INSERT INTO qa_recording_consents (booking_id, role, user_id, accepted, authority, version)
      VALUES (${bookingId},${role},${userId},${accepted},${authority},${version})
      ON CONFLICT (booking_id,role) DO UPDATE SET user_id=EXCLUDED.user_id, accepted=EXCLUDED.accepted,
        authority=EXCLUDED.authority, version=EXCLUDED.version, acknowledged_at=NOW()`;
    return this.participantState(bookingId, userId, role);
  }

  private async remember(bookingId: string, meetingId: string, record: ProviderRecording) {
    if (!/^[a-f0-9-]{36}$/i.test(record.id) || !['INVOKED','RECORDING','PAUSED','UPLOADING','UPLOADED','ERRORED'].includes(record.status))
      throw new Error('Invalid verified recording metadata');
    const invoked = new Date(record.invoked_time);
    if (!Number.isFinite(invoked.getTime())) throw new Error('Invalid recording time');
    const expiry = new Date(invoked.getTime() + QA_RETENTION_DAYS * 86400000);
    await db`INSERT INTO qa_recordings (id,booking_id,meeting_id,provider_status,invoked_at,expires_at)
      VALUES (${record.id},${bookingId},${meetingId},${record.status},${invoked},${expiry})
      ON CONFLICT (id) DO UPDATE SET provider_status=EXCLUDED.provider_status, verified_at=NOW()
      WHERE qa_recordings.booking_id=EXCLUDED.booking_id AND qa_recordings.meeting_id=EXCLUDED.meeting_id`;
  }

  async controlRoom(room: MediaRoom) {
    await this.ensureTable();
    if (!room.meeting_id) return;
    await db`INSERT INTO qa_recording_control (booking_id) VALUES (${room.booking_id}) ON CONFLICT DO NOTHING`;
    // Commit start intent before the provider request; retries recover by listing provider resources.
    const lockKey = `qa-control:${room.booking_id}`;
    await db.begin(async sql => {
      const lock = await sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked`;
      if (!lock[0].locked) return;
      const controls = await sql`SELECT * FROM qa_recording_control WHERE booking_id=${room.booking_id}`;
      const control = controls[0];
      if (new Date(control.next_attempt_at).getTime() > Date.now()) return;
      try {
        const records = await this.client.recordings(room.meeting_id!);
        for (const record of records) await this.remember(room.booking_id, room.meeting_id!, record);
        const active = records.filter(r => ACTIVE.includes(r.status));
        const schedule = await this.schedule(room.booking_id, room.owner_id, room.owner_role);
        const consentRows = await db`SELECT role,user_id,accepted,authority,version FROM qa_recording_consents WHERE booking_id=${room.booking_id}` as ConsentRow[];
        const consent = consentRows.map(c => ({ userId: c.user_id, accepted: c.accepted, authority: c.authority, version: c.version })) as Consent[];
        const currentRoom = (await db`SELECT closed,ends_at FROM classroom_media_rooms WHERE booking_id=${room.booking_id}`)[0];
        const allowed = this.enabled() && !currentRoom.closed && Date.now() < new Date(currentRoom.ends_at).getTime()
          && schedule && canCommunicateInClassroom(schedule.startsAt, schedule.endsAt) && bothRecordingConsents(consent);
        if (!allowed) {
          for (const record of active) await this.client.stopRecording(record.id);
          return;
        }
        if (active.length) return;
        // INVOKED requests can be eventually consistent. Do not immediately retry an ambiguous start.
        if (control.requested_at && Date.now() - new Date(control.requested_at).getTime() < 120000) return;
        if (control.attempts >= 6) return;
        for (const c of consentRows) {
          if (!await this.schedule(room.booking_id, c.user_id, c.role)) return;
        }
        const live = await this.client.liveParticipantIds(room.meeting_id!);
        if (!consentRows.every(c => live.includes(opaqueMediaId(`${room.meeting_id}:${c.role}:${c.user_id}`)))) return;
        const latestConsent = await db`SELECT accepted,authority,version FROM qa_recording_consents WHERE booking_id=${room.booking_id}`;
        const finalSchedule = await this.schedule(room.booking_id, room.owner_id, room.owner_role);
        const finalRoom = (await db`SELECT closed,ends_at FROM classroom_media_rooms WHERE booking_id=${room.booking_id}`)[0];
        if (!bothRecordingConsents(latestConsent as Consent[]) || !finalSchedule || !canCommunicateInClassroom(finalSchedule.startsAt, finalSchedule.endsAt)
          || finalRoom.closed || Date.now() >= new Date(finalRoom.ends_at).getTime()) return;
        // This write uses the main connection so it survives rollback if the request times out.
        await db`UPDATE qa_recording_control SET requested_at=NOW(),attempts=attempts+1 WHERE booking_id=${room.booking_id}`;
        const record = await this.client.startRecording(room.meeting_id!, (new Date(room.ends_at).getTime() - Date.now()) / 1000);
        await this.remember(room.booking_id, room.meeting_id!, record);
        await sql`UPDATE qa_recording_control SET error=NULL WHERE booking_id=${room.booking_id}`;
      } catch {
        await sql`UPDATE qa_recording_control SET error='Provider request failed; reconciliation will retry',next_attempt_at=NOW()+INTERVAL '30 seconds' WHERE booking_id=${room.booking_id}`;
        console.warn('QA recording control retry required');
      }
    });
  }

  async archiveRecord(id: string) {
    await db.begin(async sql => {
      const lock = await sql`SELECT pg_try_advisory_xact_lock(hashtext(${'qa-file:' + id})) AS locked`;
      if (!lock[0].locked) return;
      const row = (await sql`SELECT * FROM qa_recordings WHERE id=${id}`)[0];
      if (!row || row.local_status === 'deleted' || new Date(row.next_attempt_at).getTime() > Date.now()) return;
      try {
        if (Date.now() >= new Date(row.expires_at).getTime()) {
          await this.storage.remove(id);
          await sql`UPDATE qa_recordings SET local_status='deleted',deleted_at=NOW(),error=NULL WHERE id=${id}`;
          return;
        }
        if (row.local_status === 'stored') return;
        const verified = await this.client.recording(id);
        if (verified.meeting?.id !== row.meeting_id) throw new Error('Recording belongs to another meeting');
        await this.remember(row.booking_id, row.meeting_id, verified);
        if (verified.status !== 'UPLOADED') return;
        const expiry = Date.parse(verified.download_url_expiry || '');
        if (!verified.download_url || !Number.isFinite(expiry) || Date.now() >= expiry) throw new Error('Recording source unavailable');
        const stored = await this.storage.archive(id, verified.download_url, verified.file_size);
        await sql`UPDATE qa_recordings SET local_status='stored',byte_size=${stored.size},sha256=${stored.sha256},
          archived_at=NOW(),error=NULL WHERE id=${id}`;
      } catch {
        await sql`UPDATE qa_recordings SET attempts=attempts+1,error='Archive unavailable; retry queued',
          next_attempt_at=NOW()+INTERVAL '1 minute' WHERE id=${id}`;
        console.warn('QA recording archive retry required');
      }
    });
  }

  async reconcileControl() {
    await this.ensureTable();
    const rooms = await db`SELECT m.* FROM classroom_media_rooms m WHERE m.provider='realtimekit' AND m.meeting_id IS NOT NULL
      AND ((${this.enabled()} AND m.closed=FALSE)
        OR EXISTS(SELECT 1 FROM qa_recordings r WHERE r.booking_id=m.booking_id AND r.provider_status IN ('INVOKED','RECORDING','PAUSED'))
        OR (EXISTS(SELECT 1 FROM qa_recording_control c WHERE c.booking_id=m.booking_id AND c.requested_at>NOW()-INTERVAL '1 day')
          AND NOT EXISTS(SELECT 1 FROM qa_recordings r WHERE r.booking_id=m.booking_id)))` as MediaRoom[];
    for (const room of rooms) await this.controlRoom(room);
  }
  async reconcileArchives() {
    await this.ensureTable();
    const rows = await db`SELECT id FROM qa_recordings WHERE local_status!='deleted'
      AND (local_status!='stored' OR expires_at<=NOW()) AND next_attempt_at<=NOW() ORDER BY invoked_at LIMIT 20`;
    for (const row of rows) await this.archiveRecord(row.id);
  }

  async audit(adminId: string, action: string, recordingId: string | null, detail = '') {
    await this.ensureTable();
    await db`INSERT INTO qa_recording_access_log (admin_id,action,recording_id,detail) VALUES (${adminId},${action},${recordingId},${detail.slice(0,500)})`;
  }
  async list(adminId: string, page: number, bookingId: string) {
    await this.audit(adminId, 'list', null);
    const limit = 50, offset = (page - 1) * limit;
    const rows = await db`SELECT id,booking_id,provider_status,local_status,invoked_at,expires_at,byte_size,archived_at,error
      FROM qa_recordings WHERE (${bookingId}='' OR booking_id=${bookingId}) ORDER BY invoked_at DESC LIMIT ${limit} OFFSET ${offset}`;
    return rows;
  }
  async accessLog(adminId: string, id: string) {
    await this.audit(adminId, 'view_audit', id);
    return db`SELECT admin_id,action,detail,created_at FROM qa_recording_access_log WHERE recording_id=${id} ORDER BY created_at DESC LIMIT 100`;
  }
  async playback(adminId: string, id: string, range: string | null) {
    await this.ensureTable();
    const row = (await db`SELECT * FROM qa_recordings WHERE id=${id}`)[0];
    if (!row || row.local_status !== 'stored' || Date.now() >= new Date(row.expires_at).getTime()) {
      await this.audit(adminId, 'playback_denied', id); return new Response('Recording unavailable', { status: 404 });
    }
    const size = Number(row.byte_size);
    let bounds;
    try { bounds = recordingRange(range, size); }
    catch { return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } }); }
    await this.audit(adminId, 'playback', id, `${bounds.start}-${bounds.end}`);
    return new Response(this.storage.playback(id, size, bounds.start, bounds.end), {
      status: bounds.partial ? 206 : 200,
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bounds.end - bounds.start + 1),
        'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
        ...(bounds.partial ? { 'Content-Range': `bytes ${bounds.start}-${bounds.end}/${size}` } : {}) },
    });
  }
  async delete(adminId: string, id: string) {
    await this.audit(adminId, 'delete_requested', id);
    await db.begin(async sql => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'qa-file:' + id}))`;
      await this.storage.remove(id);
      await sql`UPDATE qa_recordings SET local_status='deleted',deleted_at=NOW(),error=NULL WHERE id=${id}`;
    });
    await this.audit(adminId, 'deleted', id);
  }
}

export const qaRecordingService = new QaRecordingService();
export function startQaRecordingJobs() {
  const loop = (run: () => Promise<void>, interval: number) => {
    let running = false;
    const tick = async () => { if (running) return; running = true;
      try { await run(); } catch { console.warn('QA recording worker temporarily unavailable'); } finally { running = false; } };
    void tick(); const timer = setInterval(tick, interval); timer.unref(); return timer;
  };
  if (qaRecordingService.enabled()) new QaRecordingStorage().configured();
  const control = loop(() => qaRecordingService.reconcileControl(), 10000);
  const archive = loop(() => qaRecordingService.reconcileArchives(), 30000);
  return () => { clearInterval(control); clearInterval(archive); };
}
