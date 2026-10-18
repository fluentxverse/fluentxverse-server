import { db } from '../db/postgres';
import { ScheduleService } from './schedule.services/schedule.service';
import { canCommunicateInClassroom, CLASSROOM_WRAP_UP_MS } from '../socket/classroomTiming';
import { desiredMediaProvider, RealtimeKitClient, type ClassroomMediaProvider, type ClassroomRole } from './realtimekit.client';

export interface MediaRoom {
  booking_id: string;
  provider: ClassroomMediaProvider;
  meeting_id: string | null;
  ends_at: Date;
  participant_ids: Record<string, string>;
  closed: boolean;
  owner_id: string;
  owner_role: ClassroomRole;
}

export interface MediaRoomStore {
  pin(bookingId: string, provider: ClassroomMediaProvider, endsAt: number, userId: string, role: ClassroomRole): Promise<ClassroomMediaProvider>;
  locked<T>(bookingId: string, work: (room: MediaRoom) => Promise<T>): Promise<T>;
  openRooms(): Promise<MediaRoom[]>;
  requestClose(bookingId: string): Promise<void>;
}

export class PostgresMediaRoomStore implements MediaRoomStore {
  private ready: Promise<void> | undefined;
  ensureTable() {
    this.ready ??= db`CREATE TABLE IF NOT EXISTS classroom_media_rooms (
      booking_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL CHECK (provider IN ('webrtc', 'realtimekit')),
      meeting_id TEXT UNIQUE,
      ends_at TIMESTAMPTZ NOT NULL,
      participant_ids JSONB NOT NULL DEFAULT '{}',
      closed BOOLEAN NOT NULL DEFAULT FALSE,
      owner_id TEXT NOT NULL,
      owner_role TEXT NOT NULL CHECK (owner_role IN ('student', 'tutor')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`.then(() => {}).catch(error => { this.ready = undefined; throw error; });
    return this.ready;
  }

  async pin(bookingId: string, provider: ClassroomMediaProvider, endsAt: number, userId: string, role: ClassroomRole) {
    await this.ensureTable();
    await db`INSERT INTO classroom_media_rooms (booking_id, provider, ends_at, owner_id, owner_role)
      VALUES (${bookingId}, ${provider}, ${new Date(endsAt)}, ${userId}, ${role})
      ON CONFLICT (booking_id) DO UPDATE SET ends_at = LEAST(classroom_media_rooms.ends_at, EXCLUDED.ends_at)`;
    const rows = await db`SELECT provider FROM classroom_media_rooms WHERE booking_id = ${bookingId}`;
    return rows[0].provider as ClassroomMediaProvider;
  }

  async locked<T>(bookingId: string, work: (room: MediaRoom) => Promise<T>): Promise<T> {
    await this.ensureTable();
    return db.begin(async sql => {
      const rows = await sql`SELECT * FROM classroom_media_rooms WHERE booking_id = ${bookingId} FOR UPDATE`;
      const room = rows[0] as MediaRoom | undefined;
      if (!room) throw new Error('Classroom media is not initialized');
      const result = await work(room);
      await sql`UPDATE classroom_media_rooms SET meeting_id = ${room.meeting_id},
        participant_ids = ${room.participant_ids}::jsonb, closed = ${room.closed} WHERE booking_id = ${bookingId}`;
      return result;
    });
  }

  async openRooms() {
    await this.ensureTable();
    return await db`SELECT * FROM classroom_media_rooms WHERE provider = 'realtimekit' AND closed = FALSE` as MediaRoom[];
  }

  async requestClose(bookingId: string) {
    await this.ensureTable();
    await db`UPDATE classroom_media_rooms SET ends_at = LEAST(ends_at, NOW()) WHERE booking_id = ${bookingId}`;
  }
}

export class ClassroomMediaService {
  constructor(private store: MediaRoomStore = new PostgresMediaRoomStore(),
    private client = new RealtimeKitClient(),
    private schedule = (bookingId: string, userId: string, role: ClassroomRole) => new ScheduleService().getClassroomSchedule(bookingId, userId, role),
    private now = Date.now,
    private selectProvider = desiredMediaProvider) {}

  async provider(bookingId: string, userId: string, role: ClassroomRole, endsAt: number) {
    return this.store.pin(bookingId, this.selectProvider(bookingId), endsAt + CLASSROOM_WRAP_UP_MS, userId, role);
  }

  async credentials(bookingId: string, userId: string, role: ClassroomRole) {
    const authorize = async () => {
      const schedule = await this.schedule(bookingId, userId, role);
      if (!schedule || !canCommunicateInClassroom(schedule.startsAt, schedule.endsAt, this.now()))
        throw new Error('This lesson is not available for a live call');
      return schedule;
    };
    await authorize();
    const credentials = await this.store.locked(bookingId, async room => {
      if (room.provider !== 'realtimekit' || room.closed) throw new Error('RealtimeKit is not enabled for this lesson');
      if (this.now() >= new Date(room.ends_at).getTime()) throw new Error('This lesson call has ended');
      await authorize();
      if (!room.meeting_id) room.meeting_id = await this.client.ensureMeeting(bookingId);
      const key = `${role}:${userId}`;
      const participantId = room.participant_ids[key];
      let token: string;
      if (participantId) token = await this.client.refreshToken(room.meeting_id, participantId);
      else {
        const participant = await this.client.ensureParticipant(room.meeting_id, userId, role);
        room.participant_ids[key] = participant.id;
        token = participant.token;
      }
      return { provider: 'realtimekit' as const, token, closesAt: new Date(room.ends_at).toISOString() };
    });
    // Persist provider IDs before the final check so cancelled meetings can be closed.
    try { await authorize(); }
    catch (error) { try { await this.close(bookingId); } catch { /* Reconciliation retries closure. */ } throw error; }
    return { ...credentials, serverNow: new Date(this.now()).toISOString() };
  }

  async close(bookingId: string) {
    await this.store.requestClose(bookingId);
    return this.store.locked(bookingId, async room => {
      if (room.provider !== 'realtimekit' || room.closed) return;
      if (room.meeting_id) await this.client.closeMeeting(room.meeting_id);
      room.closed = true;
    });
  }

  async reconcile() {
    for (const room of await this.store.openRooms()) {
      try {
        const expired = this.now() >= new Date(room.ends_at).getTime();
        if (expired) { await this.close(room.booking_id); continue; }
        const schedule = await this.schedule(room.booking_id, room.owner_id, room.owner_role);
        if (!schedule || this.now() >= schedule.endsAt + CLASSROOM_WRAP_UP_MS) await this.close(room.booking_id);
      } catch (error) {
        console.warn('Classroom media reconciliation failed:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }
}

export const classroomMediaService = new ClassroomMediaService();

export function startClassroomMediaReconciliation() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await classroomMediaService.reconcile(); }
    catch { console.warn('Classroom media reconciliation is temporarily unavailable'); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(run, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
