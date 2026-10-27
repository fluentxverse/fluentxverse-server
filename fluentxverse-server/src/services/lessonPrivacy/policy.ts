import type { EvidenceField, AttendanceClaims } from '../../../../shared/lessonPrivacy';
import { evidenceFields } from '../../../../shared/lessonPrivacy';

export class LessonPrivacyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function selectedFields<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(value) || !value.length || value.length > allowed.length ||
    value.some(field => !allowed.includes(field)) || new Set(value).size !== value.length)
    throw new LessonPrivacyError('Select at least one valid field, without duplicates.');
  return [...value].sort() as T[];
}

export interface PresenceInterval { role: 'student' | 'tutor'; joinedAt: string; lastSeenAt: string | null; leftAt: string | null }
type Interval = [number, number];
export function mergedPresence(rows: PresenceInterval[], role: 'student' | 'tutor', start: number, end: number): Interval[] {
  const intervals: Interval[] = [];
  for (const row of rows) {
    if (row.role !== role) continue;
    const from = Math.max(start, Date.parse(row.joinedAt));
    // Count only time bounded by a stored observation. Never extrapolate to lesson end.
    const observed = row.lastSeenAt ? Date.parse(row.lastSeenAt) : Date.parse(row.joinedAt);
    const to = Math.min(end, observed, row.leftAt ? Date.parse(row.leftAt) : end);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) intervals.push([from, to]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && last[1] >= interval[0]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  return merged;
}
export function attendanceClaims(rows: PresenceInterval[], start: number, end: number, thresholdMinutes: number,
  fields: EvidenceField[], status: string, cancelledAt: string | null): AttendanceClaims {
  selectedFields(fields, evidenceFields);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(thresholdMinutes) || thresholdMinutes <= 0)
    throw new LessonPrivacyError('Lesson timing is unavailable.');
  const student = mergedPresence(rows, 'student', start, end), tutor = mergedPresence(rows, 'tutor', start, end);
  const duration = (intervals: Interval[]) => intervals.reduce((total, [from, to]) => total + to - from, 0);
  const meets = (ms: number) => ms >= thresholdMinutes * 60000 ? 'threshold_met' as const : 'not_established' as const;
  const claims: AttendanceClaims = {};
  if (fields.includes('attendance')) claims.attendance = { student: meets(duration(student)), tutor: meets(duration(tutor)) };
  if (fields.includes('overlap')) {
    let overlap = 0, i = 0, j = 0;
    while (i < student.length && j < tutor.length) {
      overlap += Math.max(0, Math.min(student[i]![1], tutor[j]![1]) - Math.max(student[i]![0], tutor[j]![0]));
      if (student[i]![1] < tutor[j]![1]) i++; else j++;
    }
    claims.overlap = meets(overlap);
  }
  if (fields.includes('cancellation')) {
    const cancelled = cancelledAt ? Date.parse(cancelledAt) : NaN;
    claims.cancellation = status !== 'cancelled' ? 'not_cancelled' : !Number.isFinite(cancelled) ? 'timing_unknown'
      : cancelled <= start - 3600000 ? 'at_least_one_hour_before' : 'less_than_one_hour_before';
  }
  return claims;
}
