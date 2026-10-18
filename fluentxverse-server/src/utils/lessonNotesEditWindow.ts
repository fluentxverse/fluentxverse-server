export interface LessonNotesEditWindow {
  startsAt: string;
  endsAt: string;
  editableUntil: string;
  serverNow: string;
  canEdit: boolean;
  reason: 'not_started' | 'expired' | 'cancelled' | null;
}

export function lessonNotesEditWindow(
  startsAt: string,
  durationMinutes: number | null,
  status: string,
  now = Date.now(),
  reopenedUntil?: string | null,
): LessonNotesEditWindow {
  const start = Date.parse(startsAt);
  const end = start + (durationMinutes && durationMinutes > 0 ? durationMinutes : 25) * 60_000;
  const deadline = Math.max(end + 48 * 60 * 60_000, Number.isFinite(Date.parse(reopenedUntil || '')) ? Date.parse(reopenedUntil!) : 0);
  const reason =
    status === 'cancelled' ? 'cancelled' : now < start ? 'not_started' : now >= deadline ? 'expired' : null;
  return {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
    editableUntil: new Date(deadline).toISOString(),
    serverNow: new Date(now).toISOString(),
    canEdit: reason === null,
    reason,
  };
}

export class LessonNotesReadOnly extends Error {}
