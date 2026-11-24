import { createHash } from 'node:crypto';

export class RewardError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function usdMicros(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?$/.test(value)) throw new RewardError(400, 'Enter a positive USD amount with up to six decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (result <= 0n) throw new RewardError(400, 'The USD amount must be greater than zero.');
  return result;
}
export function rewardMonth(month: unknown) {
  if (typeof month !== 'string' || !/^20[2-9][0-9]-(0[1-9]|1[0-2])$/.test(month)) throw new RewardError(400, 'Choose a valid reward month.');
  const [year, m] = month.split('-').map(Number) as [number, number];
  const startsAt = new Date(Date.UTC(year, m - 1, 1) - 8 * 3_600_000).toISOString();
  const endsAt = new Date(Date.UTC(year, m, 1) - 8 * 3_600_000).toISOString();
  return { month, periodId: year * 100 + m, startsAt, endsAt };
}
export function rewardAmount(count: number, minimum: number, rate: bigint) {
  if (!Number.isInteger(count) || count < 0 || count > 0xffffffff || !Number.isInteger(minimum) || minimum < 1 || minimum > 0xffffffff || rate <= 0n) {
    throw new RewardError(400, 'Invalid lesson threshold, count or rate.');
  }
  return count >= minimum ? BigInt(count) * rate : 0n;
}
export interface RewardReport { status: string; decision?: string | null }
export function rewardLesson(booking: Record<string, any>, reports: RewardReport[], activeTa301: boolean, now = Date.now()): 'completed' | 'held' | 'excluded' {
  if (activeTa301 || ['301', 'TA-301'].includes(String(booking.penaltyCode || '')) || booking.issueDecision === 'past'
    || ['cancelled', 'past'].includes(booking.status)) return 'excluded';
  if (reports.some(r => r.status === 'resolved' && r.decision === 'completion_rejected')) return 'excluded';
  if (booking.disputeHold || booking.compensationHold || reports.some(r => r.status !== 'resolved'
    || !['completion_approved', 'alternative_approved'].includes(r.decision || ''))) return 'held';
  const finalAt = Date.parse(String(booking.finalizedAt || ''));
  const start = Date.parse(String(booking.slotDateTime || ''));
  const minutes = Number(booking.durationMinutes ?? 25);
  if (!Number.isFinite(start) || !Number.isFinite(minutes) || minutes <= 0 || minutes > 180) return 'held';
  const end = start + minutes * 60_000;
  // Reward eligibility follows business completion, not proof generation or both-participant attendance.
  if (booking.status !== 'completed' || !Number.isFinite(finalAt) || finalAt < end || finalAt > now || end > now) return 'held';
  return 'completed';
}
export const rewardDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
export function rewardAddress(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || BigInt(value) === 0n) throw new RewardError(400, 'A nonzero token or wallet address is required.');
  return value.toLowerCase() as `0x${string}`;
}
export function rewardTimestamp(value: unknown) {
  if (typeof value !== 'string' || !/Z$|[+-]\d\d:\d\d$/.test(value) || !Number.isFinite(Date.parse(value))) throw new RewardError(400, 'Use a timestamp with an explicit timezone.');
  return Math.floor(Date.parse(value) / 1000);
}
