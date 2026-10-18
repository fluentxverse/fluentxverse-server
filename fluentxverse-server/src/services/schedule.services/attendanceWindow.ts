export interface AttendanceSlotTime {
  date: string;
  time: string;
  bookedAtMs?: number;
}

export const NORMAL_DEADLINE_MINUTES = 11;
export function attendanceDeadlineMs(startMs: number): number {
  return startMs - NORMAL_DEADLINE_MINUTES * 60_000;
}

export function attendanceStartMs({ date, time }: AttendanceSlotTime): number {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(time.trim());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !match) {
    throw new Error('Invalid attendance slot date or time');
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > (match[3] ? 12 : 23) || (match[3] && hour < 1)) {
    throw new Error('Invalid attendance slot time');
  }
  if (match[3]) hour = (hour % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0);

  const timestamp = Date.parse(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`);
  if (Number.isNaN(timestamp) || new Date(timestamp + 8 * 60 * 60_000).toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid attendance slot date');
  }
  return timestamp;
}

export function validateAttendanceWindow(slots: AttendanceSlotTime[], nowMs = Date.now()): void {
  if (slots.length < 1 || slots.length > 12) throw new Error('Select 1 to 12 attendance slots');
  const sorted = slots.map(slot => ({ date: slot.date, start: attendanceStartMs(slot), bookedAtMs: slot.bookedAtMs }))
    .sort((a, b) => a.start - b.start);
  const first = sorted[0]!;
  const minutesBeforeFirst = (first.start - nowMs) / 60_000;
  const normalWindow = minutesBeforeFirst >= NORMAL_DEADLINE_MINUTES && minutesBeforeFirst <= 35;
  if (!normalWindow) {
    throw new Error('Attendance can be updated 35 to 11 minutes before the first lesson');
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.date !== first.date || sorted[i]!.start - sorted[i - 1]!.start !== 30 * 60_000) {
      throw new Error('Select consecutive 30-minute slots on the same day');
    }
  }
}

export function validateAttendanceWithPresentNeighbors(
  slots: AttendanceSlotTime[],
  presentSlots: AttendanceSlotTime[],
  status: 'present' | 'absent',
  nowMs = Date.now()
): void {
  try {
    validateAttendanceWindow(slots, nowMs);
    return;
  } catch (originalError) {
    if (status !== 'present' || !slots.length || slots.length > 12) throw originalError;

    const first = slots.reduce((earliest, slot) =>
      attendanceStartMs(slot) < attendanceStartMs(earliest) ? slot : earliest);
    let previousStart = attendanceStartMs(first);
    const chain: AttendanceSlotTime[] = [];
    while (chain.length + slots.length < 12) {
      const neighbor = presentSlots.find(slot =>
        slot.date === first.date && attendanceStartMs(slot) === previousStart - 30 * 60_000);
      if (!neighbor) break;
      chain.unshift(neighbor);
      previousStart -= 30 * 60_000;
      try {
        validateAttendanceWindow([...chain, ...slots], nowMs);
        return;
      } catch {
        // An earlier confirmed slot may be the one inside the attendance window.
      }
    }
    throw originalError;
  }
}
