import { query } from '../db/postgres';
let ready: Promise<void> | null = null;
async function ensureSchema() {
  if (!ready) ready = query(`CREATE TABLE IF NOT EXISTS classroom_media_observations (
    id BIGSERIAL PRIMARY KEY, booking_id TEXT NOT NULL, user_id TEXT NOT NULL,
    user_type TEXT NOT NULL, connected BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`).then(async () => { await query('CREATE INDEX IF NOT EXISTS classroom_media_booking_idx ON classroom_media_observations (booking_id, created_at)'); }).catch(e => { ready = null; throw e; });
  await ready;
}
export async function recordMediaObservation(bookingId: string, userId: string, role: string, connected: boolean) {
  await ensureSchema();
  await query('INSERT INTO classroom_media_observations (booking_id,user_id,user_type,connected) VALUES ($1,$2,$3,$4)', [bookingId, userId, role, connected]);
}
export async function mediaObservations(bookingId: string) {
  await ensureSchema();
  return (await query('SELECT user_type,connected,created_at FROM classroom_media_observations WHERE booking_id=$1 ORDER BY created_at DESC LIMIT 1000', [bookingId])).rows;
}
