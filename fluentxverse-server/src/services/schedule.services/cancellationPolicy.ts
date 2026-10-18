export const ABSENCE_REASONS = [
  'Internet Outage',
  'Electric Outage',
  'Emergency',
  'Disaster',
  'Health',
  'Others'
] as const;

export type AbsenceReason = typeof ABSENCE_REASONS[number];

const PHT_OFFSET_MS = 8 * 60 * 60_000;
const SHORT_NOTICE_MS = 48 * 60 * 60_000;

export function phtDate(timestampMs: number): string {
  return new Date(timestampMs + PHT_OFFSET_MS).toISOString().slice(0, 10);
}

export function isShortNoticeCancellation(startMs: number, nowMs: number): boolean {
  return startMs - nowMs < SHORT_NOTICE_MS;
}

export function validateAbsenceTime(startMs: number, nowMs: number): void {
  if (startMs - nowMs < 11 * 60_000) {
    throw new Error('An open slot can only be cancelled at least 11 minutes before it starts');
  }
}

export function validateReopenPolicy(params: {
  slotDate: string;
  nowMs: number;
  lastPenaltyMs?: number;
  penaltyCount: number;
  reopenCount: number;
}): void {
  const { slotDate, nowMs, lastPenaltyMs, penaltyCount, reopenCount } = params;
  if (penaltyCount === 0) return;
  if (penaltyCount >= 2 || reopenCount >= 1) {
    throw new Error('This TA-303 slot has already used its one reopening');
  }
  if (lastPenaltyMs === undefined) {
    throw new Error('TA-303 history is unavailable; this slot cannot be reopened');
  }
  if (phtDate(nowMs) !== slotDate) {
    throw new Error('A TA-303 slot can only be reopened on its lesson day');
  }
  if (phtDate(lastPenaltyMs) === slotDate && nowMs - lastPenaltyMs < 30 * 60_000) {
    throw new Error('Wait 30 minutes after the same-day TA-303 before reopening');
  }
}
export const STUDENT_CANCELLATION_CUTOFF_MS = 5 * 60_000;

export function canStudentCancelLesson(status: string, startsAt: number, now = Date.now()) {
  return status === 'confirmed' && Number.isFinite(startsAt) && now < startsAt - STUDENT_CANCELLATION_CUTOFF_MS;
}
