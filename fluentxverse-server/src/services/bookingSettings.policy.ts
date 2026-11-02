export interface BookingPolicy { mode: 'trial' | 'paid'; trialLessonLimit: number }
export interface BookingSettings extends BookingPolicy { revision: number; updatedAt: string | null }
export class BookingSettingsError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function validateBookingPolicy(value: BookingPolicy): BookingPolicy {
  if (!['trial', 'paid'].includes(value.mode)) throw new BookingSettingsError('Choose free trial or paid bookings.');
  if (!Number.isInteger(value.trialLessonLimit) || value.trialLessonLimit < 1 || value.trialLessonLimit > 999)
    throw new BookingSettingsError('Free trials per student must be a whole number between 1 and 999.');
  return { mode: value.mode, trialLessonLimit: value.trialLessonLimit };
}
export function environmentBookingPolicy(): BookingPolicy {
  const mode = process.env.LESSON_BOOKING_MODE || 'trial';
  const raw = process.env.TRIAL_LESSON_LIMIT || '1';
  if (!/^[1-9][0-9]{0,2}$/.test(raw)) throw new BookingSettingsError('Trial lesson limit must be between 1 and 999');
  return validateBookingPolicy({ mode: mode as BookingPolicy['mode'], trialLessonLimit: Number(raw) });
}
