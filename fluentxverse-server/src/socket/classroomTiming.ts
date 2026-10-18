export const CLASSROOM_EARLY_ENTRY_MS = 5 * 60_000;
export const CLASSROOM_WRAP_UP_MS = 3 * 60_000;

export function canEnterClassroom(startsAt: number, endsAt: number, now = Date.now()) {
  return Number.isFinite(startsAt) && Number.isFinite(endsAt)
    && now >= startsAt - CLASSROOM_EARLY_ENTRY_MS && now < endsAt + CLASSROOM_WRAP_UP_MS;
}

export function canCommunicateInClassroom(startsAt?: number, endsAt?: number, now = Date.now()) {
  return typeof startsAt === 'number' && Number.isFinite(startsAt)
    && typeof endsAt === 'number' && Number.isFinite(endsAt)
    && now >= startsAt && now < endsAt + CLASSROOM_WRAP_UP_MS;
}
