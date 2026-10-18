export function trialLaunchMode() {
  const mode = process.env.LESSON_BOOKING_MODE || 'trial';
  if (!['trial', 'paid'].includes(mode)) throw new Error('Unknown lesson booking mode');
  return mode === 'trial';
}
export function trialLessonLimit() {
  const raw = process.env.TRIAL_LESSON_LIMIT || '1';
  if (!/^[1-9][0-9]{0,2}$/.test(raw)) throw new Error('Trial lesson limit must be between 1 and 999');
  return Number(raw);
}
export function trialCanBeRestored(booking: { paymentMethod?: string; status: string; slotDateTime: any; cancelledAt?: any; cancelledBy?: string; studentId?: string }) {
  if (booking.paymentMethod !== 'trial' || booking.status !== 'cancelled') return false;
  const date = (value: any) => value?.toStandardDate?.() ?? new Date(value);
  return Boolean(booking.cancelledBy) && (booking.cancelledBy !== booking.studentId
    || date(booking.slotDateTime).getTime() - date(booking.cancelledAt).getTime() >= 3600_000);
}
export async function assertTrialAllowance(tx: { run: (query: string, params: any) => Promise<any> }, studentId: string) {
  const result = await tx.run(`MATCH (b:Booking {studentId: $studentId, paymentMethod: 'trial'})
    WHERE CASE WHEN b.status = 'cancelled' AND b.cancelledBy IS NOT NULL
      AND (b.cancelledBy <> b.studentId OR b.cancelledAt <= b.slotDateTime - duration('PT1H'))
      THEN false ELSE true END
    RETURN count(b) AS used`, { studentId });
  const value = result.records[0]?.get('used'), used = value?.toNumber ? value.toNumber() : Number(value);
  if (!Number.isSafeInteger(used) || used < 0) throw new Error('Trial allowance is unavailable');
  if (used >= trialLessonLimit()) throw new Error('Your free trial allowance has already been used or reserved');
}
