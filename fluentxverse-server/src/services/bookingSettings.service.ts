import { db } from '../db/postgres';
import { BookingSettingsError, environmentBookingPolicy, validateBookingPolicy, type BookingPolicy, type BookingSettings } from './bookingSettings.policy';

let ready: Promise<void> | undefined;
async function ensureTables() {
  ready ??= (async () => {
    await db`CREATE TABLE IF NOT EXISTS platform_booking_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL CHECK(mode IN ('trial','paid')),
      trial_lesson_limit INTEGER NOT NULL CHECK(trial_lesson_limit BETWEEN 1 AND 999),
      revision INTEGER NOT NULL CHECK(revision>0), updated_by TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
    await db`CREATE TABLE IF NOT EXISTS platform_booking_settings_audit (
      id BIGSERIAL PRIMARY KEY, actor_id TEXT NOT NULL, previous_mode TEXT NOT NULL, mode TEXT NOT NULL,
      previous_trial_lesson_limit INTEGER NOT NULL, trial_lesson_limit INTEGER NOT NULL,
      revision INTEGER NOT NULL UNIQUE, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  })().catch(error => { ready = undefined; throw error; });
  await ready;
}
const fromRow = (row: any): BookingSettings => ({
  ...validateBookingPolicy({ mode: row.mode, trialLessonLimit: Number(row.trial_lesson_limit) }),
  revision: Number(row.revision), updatedAt: new Date(row.updated_at).toISOString(),
});
export const bookingSettingsService = {
  async get(): Promise<BookingSettings> {
    await ensureTables();
    const rows = await db`SELECT * FROM platform_booking_settings WHERE id=1`;
    return rows[0] ? fromRow(rows[0]) : { ...environmentBookingPolicy(), revision: 0, updatedAt: null };
  },
  async update(value: BookingPolicy, revision: number, actorId: string): Promise<BookingSettings> {
    const policy = validateBookingPolicy(value);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new BookingSettingsError('Invalid settings revision. Reload and try again.');
    if (!actorId) throw new BookingSettingsError('Administrator authentication required.', 401);
    await ensureTables();
    return db.begin(async tx => {
      const current = (await tx`SELECT * FROM platform_booking_settings WHERE id=1`)[0];
      const previous = current ? fromRow(current) : { ...environmentBookingPolicy(), revision: 0 };
      if (previous.revision !== revision) throw new BookingSettingsError('Booking settings changed in another session. Reload before saving.', 409);
      const rows = revision === 0
        ? await tx`INSERT INTO platform_booking_settings(id,mode,trial_lesson_limit,revision,updated_by)
            VALUES(1,${policy.mode},${policy.trialLessonLimit},1,${actorId}) ON CONFLICT(id) DO NOTHING RETURNING *`
        : await tx`UPDATE platform_booking_settings SET mode=${policy.mode},trial_lesson_limit=${policy.trialLessonLimit},
            revision=revision+1,updated_by=${actorId},updated_at=NOW() WHERE id=1 AND revision=${revision} RETURNING *`;
      if (!rows[0]) throw new BookingSettingsError('Booking settings changed in another session. Reload before saving.', 409);
      await tx`INSERT INTO platform_booking_settings_audit(actor_id,previous_mode,mode,previous_trial_lesson_limit,trial_lesson_limit,revision)
        VALUES(${actorId},${previous.mode},${policy.mode},${previous.trialLessonLimit},${policy.trialLessonLimit},${Number(rows[0].revision)})`;
      return fromRow(rows[0]);
    });
  },
};
