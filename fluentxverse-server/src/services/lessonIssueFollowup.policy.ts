export const EXPLANATION_WINDOW_MS = 24 * 60 * 60_000;
export function replyText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 10 || value.trim().length > 2000)
    throw new Error('Write an explanation between 10 and 2,000 characters.');
  return value.trim();
}
export function explanationExpired(deadline: string, now: number) {
  const expires = Date.parse(deadline);
  if (!Number.isFinite(expires)) throw new Error('Invalid explanation deadline');
  return now >= expires;
}
export function followupMessage(startsAt: string, minutes: number, deadline: string) {
  const format = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `You selected Other for a student-related issue for the lesson on ${format.format(new Date(startsAt))} to ${format.format(new Date(Date.parse(startsAt) + minutes * 60000))} (Asia/Manila, UTC+08:00).\n\nReply here explaining what happened. Do not include student names, contact details, or other identifying personal information.\n\nWarning: If you do not reply within 24 hours, by ${format.format(new Date(deadline))} (Asia/Manila, UTC+08:00), this lesson will automatically be marked TA-301. Reading this message or an administrator replying does not satisfy this requirement.`;
}
