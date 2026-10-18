import type { ManagedTransaction } from 'neo4j-driver';
import { attendanceStartMs } from './attendanceWindow';
import { CHECKOUT_HOLD_MINUTES } from './bookingPolicy';

export function lessonsOverlap(start: number, duration: number, otherStart: number, otherDuration: number) {
  return start < otherStart + otherDuration * 60_000 && otherStart < start + duration * 60_000;
}

export async function assertTutorCanSchedule(tx: ManagedTransaction, tutorId: string) {
  const result = await tx.run(`MATCH (t:User {id: $tutorId})
    SET t.scheduleWriteVersion = coalesce(t.scheduleWriteVersion, 0) + 1
    RETURN t.isBlocked AS blocked, t.blockExpiresAt AS expires`, { tutorId });
  const row = result.records[0];
  if (!row) throw new Error('Tutor not found');
  const expires = row.get('expires')?.toStandardDate?.().getTime();
  if (row.get('blocked') && (expires === undefined || expires > Date.now())) {
    throw new Error('This tutor is temporarily blocked from opening or accepting new lesson bookings');
  }
}

export async function assertStudentScheduleAvailable(tx: ManagedTransaction, studentId: string, slot: {
  slotId: string; slotDate: string; slotTime: string; durationMinutes?: number;
}) {
  // Every reservation and booking writes the same student node to serialize concurrent checkouts.
  const student = await tx.run(`MATCH (s:Student {id: $studentId})
    SET s.bookingWriteVersion = coalesce(s.bookingWriteVersion, 0) + 1 RETURN s.id AS id`, { studentId });
  if (!student.records.length) throw new Error('Student account not found');
  const start = attendanceStartMs({ date: slot.slotDate, time: slot.slotTime });
  const duration = Number(slot.durationMinutes) || 25;
  const bookings = await tx.run(`MATCH (b:Booking)-[:BOOKED_BY]->(:Student {id: $studentId})
    WHERE b.status IN ['confirmed', 'completed'] AND coalesce(b.slotId, '') <> $slotId
    RETURN b.slotDateTime AS start, b.durationMinutes AS duration`, { studentId, slotId: slot.slotId });
  if (bookings.records.some(row => lessonsOverlap(start, duration,
    row.get('start')?.toStandardDate?.().getTime(), Number(row.get('duration')) || 25))) {
    throw new Error('You already have a lesson at this time. Choose a non-overlapping schedule.');
  }
  const holds = await tx.run(`MATCH (s:TimeSlot {pendingBy: $studentId, status: 'pending'})
    WHERE s.slotId <> $slotId AND (s.pendingUntil > datetime() OR
      (s.pendingUntil IS NULL AND s.pendingAt > datetime($expiredBefore)))
    RETURN s.slotDate AS date, s.slotTime AS time, s.durationMinutes AS duration`, {
    studentId, slotId: slot.slotId, expiredBefore: new Date(Date.now() - CHECKOUT_HOLD_MINUTES * 60000).toISOString(),
  });
  if (holds.records.some(row => lessonsOverlap(start, duration,
    attendanceStartMs({ date: row.get('date'), time: row.get('time') }), Number(row.get('duration')) || 25))) {
    throw new Error('Another checkout overlaps this lesson. Finish or release it before choosing this time.');
  }
}
