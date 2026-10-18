import { expect, test } from 'bun:test';
import { PostgresMediaRoomStore } from '../src/services/classroomMedia.service';
import { db } from '../src/db/postgres';

test.skipIf(process.env.RUN_CLASSROOM_MEDIA_DB_TEST !== '1')('PostgreSQL pins providers and serializes participant changes across store instances', async () => {
  const first = new PostgresMediaRoomStore();
  const second = new PostgresMediaRoomStore();
  const id = `media-integration-${crypto.randomUUID()}`;
  try {
    // Initialize DDL before testing cross-instance row locking.
    await first.ensureTable();
    await second.ensureTable();
    const providers = await Promise.all([
      first.pin(id, 'realtimekit', Date.now() + 60_000, 'smoke', 'student'),
      second.pin(id, 'webrtc', Date.now() + 60_000, 'smoke', 'tutor'),
    ]);
    expect(providers[0]).toBe(providers[1]);
    await Promise.all([
      first.locked(id, async room => { await Bun.sleep(20); room.participant_ids.student = 'student-smoke'; }),
      second.locked(id, async room => { room.participant_ids.tutor = 'tutor-smoke'; }),
    ]);
    expect(await first.locked(id, async room => room.participant_ids)).toEqual({ student: 'student-smoke', tutor: 'tutor-smoke' });
    await first.requestClose(id);
    expect(await first.locked(id, async room => new Date(room.ends_at).getTime())).toBeLessThanOrEqual(Date.now());
  } finally { await db`DELETE FROM classroom_media_rooms WHERE booking_id = ${id}`; }
});
