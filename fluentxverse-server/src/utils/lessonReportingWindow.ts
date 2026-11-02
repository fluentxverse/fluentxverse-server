export const STUDENT_REPORTING_WINDOW_MS = 48 * 60 * 60_000;

// Reporting is deliberately independent of the support-reopened notes deadline.
export function lessonReportingWindow(startsAt: string, durationMinutes: number | null, status: string, now = Date.now()) {
  const start = Date.parse(startsAt);
  const duration = durationMinutes == null ? 25 : durationMinutes;
  if (!Number.isFinite(start) || !Number.isInteger(duration) || duration <= 0 || duration > 180 || !Number.isFinite(now)) {
    throw new Error('Lesson timing is unavailable.');
  }
  const end = start + duration * 60_000, deadline = end + STUDENT_REPORTING_WINDOW_MS;
  const reason = status === 'cancelled' ? 'cancelled' : now < start ? 'not_started' : now >= deadline ? 'expired' : null;
  return { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
    closesAt: new Date(deadline).toISOString(), serverNow: new Date(now).toISOString(), reason };
}
