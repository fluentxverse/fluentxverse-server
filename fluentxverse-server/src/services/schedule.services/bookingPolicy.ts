export const BOOKING_CUTOFF_MINUTES = 5;
export const SLOT_OPEN_LEAD_MINUTES = 11;
export const CHECKOUT_HOLD_MINUTES = 7;

export function bookingCutoffMs(startMs: number, tutorPresent: boolean): number {
  return startMs - (tutorPresent ? BOOKING_CUTOFF_MINUTES : SLOT_OPEN_LEAD_MINUTES) * 60_000;
}

export function canReserveForBooking(startMs: number, nowMs: number, tutorPresent = false): boolean {
  return tutorPresent
    ? nowMs <= bookingCutoffMs(startMs, true)
    : nowMs < bookingCutoffMs(startMs, false);
}

export function canOpenSlot(startMs: number, nowMs: number): boolean {
  return startMs - nowMs >= SLOT_OPEN_LEAD_MINUTES * 60_000;
}

export const BOOKING_CUTOFF_MESSAGE = 'Unconfirmed slots close 11 minutes before class. Tutor-confirmed slots can be booked until 5 minutes before class';
