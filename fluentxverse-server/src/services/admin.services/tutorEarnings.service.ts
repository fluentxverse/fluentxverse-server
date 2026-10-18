import { int, type ManagedTransaction } from 'neo4j-driver';
import { getDriver } from '../../db/memgraph';
import { adminCapabilities, plainNode } from '../../utils/adminOperations';
import { MAX_TUTOR_RATE_CENTS } from '../../shared/tutorCompensation';
import { compensationTutorId, ensureCompensationSchema, TutorCompensationError } from './tutorCompensation.service';

export const PAYOUT_POLICY = 'fluentxverse.usd-earnings.v1.zero-fee';
export function earningsReason(reason: unknown): string {
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) throw new TutorCompensationError(400, 'A financial approval reason is required.');
  return reason.trim();
}
export function payableCompletion(booking: Record<string, any>, now = Date.now()) {
  const b = plainNode(booking), completed = Date.parse(b.finalizedAt || '');
  const starts = Date.parse(b.slotDateTime || ''), minutes = b.durationMinutes ?? 25;
  if (b.status !== 'completed' || b.lessonOutcome !== 'attended' || b.attendanceTutor !== 'present' || b.attendanceStudent !== 'present'
    || !Number.isFinite(completed) || completed > now || !Number.isFinite(starts) || !Number.isInteger(minutes) || minutes < 1 || minutes > 180
    || starts + minutes * 60000 > completed || b.refunded || b.refundApprovedBy
    || !['', 'not_required'].includes(b.refundStatus || '') || b.compensationHold) {
    throw new TutorCompensationError(409, 'Lesson is not finalized and payable, or requires financial review.');
  }
  return new Date(completed).toISOString();
}
export interface PayoutReservationInput { requestId: string; bookingIds: string[]; recipient: string; reason: string }
export function payoutReservation(input: PayoutReservationInput) {
  if (!input || Object.keys(input).sort().join(',') !== 'bookingIds,reason,recipient,requestId'
    || typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)
    || !Array.isArray(input.bookingIds) || input.bookingIds.length < 1 || input.bookingIds.length > 4
    || new Set(input.bookingIds).size !== input.bookingIds.length
    || typeof input.recipient !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(input.recipient) || BigInt(input.recipient) === 0n) {
    throw new TutorCompensationError(400, 'Choose 1 to 4 distinct earnings, a recipient, and a unique payout request ID.');
  }
  input.bookingIds.forEach(compensationTutorId);
  return { ...input, bookingIds: [...input.bookingIds].sort(), recipient: input.recipient.toLowerCase(), reason: earningsReason(input.reason) };
}
async function finance(tx: ManagedTransaction, actorId: string) {
  const a = (await tx.run('MATCH (a:Admin {id:$actorId}) RETURN a', { actorId })).records[0]?.get('a')?.properties;
  if (!a || !['admin', 'superadmin'].includes(a.role || 'admin') || !adminCapabilities(a).includes('finance')) {
    throw new TutorCompensationError(403, 'Finance permission required.');
  }
}
async function lockTutor(tx: ManagedTransaction, tutorId: string) {
  const rows = await tx.run(`MATCH (:User {id:$tutorId})-[:HAS_COMPENSATION]->(r:TutorCompensation {tutorId:$tutorId})
    SET r.writeRevision = coalesce(r.writeRevision,0)+1 RETURN r`, { tutorId });
  if (!rows.records.length) throw new TutorCompensationError(409, 'Set the tutor base rate before recording earnings.');
}
async function lockedBooking(tx: ManagedTransaction, tutorId: string, bookingId: string) {
  const rows = await tx.run(`MATCH (b:Booking {bookingId:$bookingId,tutorId:$tutorId})
    SET b.compensationWriteRevision=coalesce(b.compensationWriteRevision,0)+1 RETURN b`, { tutorId, bookingId });
  if (rows.records.length !== 1) throw new TutorCompensationError(404, 'Tutor lesson not found.');
  const b = rows.records[0]!.get('b').properties;
  payableCompletion(b);
  return b;
}
function financialFailure(error: any): never {
  if (error instanceof TutorCompensationError) throw error;
  if (/conflict|serialization|constraint.*violat|violat.*constraint/i.test(String(error?.code) + ' ' + String(error?.message))) {
    throw new TutorCompensationError(409, 'Financial records changed concurrently. Reload before retrying.');
  }
  throw error;
}

export class TutorEarningsService {
  async post(tutorId: string, bookingId: string, actorId: string, reason: string) {
    compensationTutorId(tutorId); compensationTutorId(bookingId); reason = earningsReason(reason);
    await ensureCompensationSchema(); const session = getDriver().session();
    try {
      return await session.executeWrite(async tx => {
        await finance(tx, actorId); await lockTutor(tx, tutorId);
        const booking = await lockedBooking(tx, tutorId, bookingId), completionAt = payableCompletion(booking);
        const old = (await tx.run('MATCH (e:TutorEarning {bookingId:$bookingId}) RETURN e', { bookingId })).records[0];
        if (old) {
          const earning = plainNode(old.get('e').properties);
          if (earning.tutorId !== tutorId) throw new TutorCompensationError(409, 'Earning tutor binding differs.');
          return { earning, replayed: true };
        }
        const row = (await tx.run(`MATCH (h:TutorRateChange {tutorId:$tutorId}) WHERE h.changedAt <= $completionAt
          RETURN h ORDER BY h.version DESC LIMIT 1`, { tutorId, completionAt })).records[0];
        const rate = row && plainNode(row.get('h').properties);
        if (!rate || !Number.isSafeInteger(rate.baseRateCents) || rate.baseRateCents < 1 || rate.baseRateCents > MAX_TUTOR_RATE_CENTS) {
          throw new TutorCompensationError(409, 'No approved rate existed at finalized completion. Historical backfill requires review.');
        }
        const now = new Date().toISOString();
        const earned = await tx.run(`MATCH (b:Booking {bookingId:$bookingId}), (r:TutorCompensation {tutorId:$tutorId})
          CREATE (e:TutorEarning {bookingId:$bookingId,tutorId:$tutorId,currency:'USD',units:1,rateVersion:$version,
            grossCents:$cents,feeCents:0,netCents:$cents,policy:$policy,completionAt:$completionAt,
            recordedAt:$now,approvedBy:$actorId,approvalReason:$reason,status:'unclaimed'})
          CREATE (b)-[:HAS_TUTOR_EARNING]->(e) CREATE (r)-[:HAS_EARNING]->(e) RETURN e`,
        { tutorId, bookingId, version: int(rate.version), cents: int(rate.baseRateCents), policy: PAYOUT_POLICY, completionAt, now, actorId, reason });
        return { earning: plainNode(earned.records[0]!.get('e').properties), replayed: false };
      });
    } catch (e) { return financialFailure(e); } finally { await session.close(); }
  }

  async list(tutorId: string, actorId: string) {
    compensationTutorId(tutorId); await ensureCompensationSchema(); const session = getDriver().session();
    try {
      return await session.executeRead(async tx => {
        await finance(tx, actorId);
        const rows = await tx.run(`MATCH (e:TutorEarning {tutorId:$tutorId}) RETURN e ORDER BY e.recordedAt DESC, e.bookingId LIMIT 100`, { tutorId });
        return rows.records.map(r => plainNode(r.get('e').properties));
      });
    } finally { await session.close(); }
  }

  async reserve(tutorId: string, request: PayoutReservationInput, actorId: string) {
    compensationTutorId(tutorId); const input = payoutReservation(request);
    await ensureCompensationSchema(); const session = getDriver().session();
    try {
      return await session.executeWrite(async tx => {
        await finance(tx, actorId); await lockTutor(tx, tutorId);
        const old = (await tx.run('MATCH (p:TutorPayoutBatch {id:$id}) RETURN p', { id: input.requestId })).records[0];
        if (old) {
          const batch = plainNode(old.get('p').properties);
          if (batch.tutorId !== tutorId || batch.approvedBy !== actorId || batch.recipient !== input.recipient
            || batch.reason !== input.reason || batch.bookingIdsJson !== JSON.stringify(input.bookingIds)) throw new TutorCompensationError(409, 'Payout request ID was already used for another request.');
          return { batch, replayed: true };
        }
        const earnings: Record<string, any>[] = [];
        for (const bookingId of input.bookingIds) {
          await lockedBooking(tx, tutorId, bookingId);
          const row = (await tx.run('MATCH (e:TutorEarning {bookingId:$bookingId,tutorId:$tutorId}) RETURN e', { bookingId, tutorId })).records[0];
          const e = row && plainNode(row.get('e').properties);
          if (!e || e.status !== 'unclaimed' || e.payoutBatchId || e.policy !== PAYOUT_POLICY || e.units !== 1
            || !Number.isSafeInteger(e.netCents) || e.netCents < 1 || e.netCents !== e.grossCents || e.feeCents !== 0) throw new TutorCompensationError(409, 'An earning is missing, held, or already reserved.');
          earnings.push(e);
        }
        const total = earnings.reduce((n, e) => n + e.netCents, 0), now = new Date().toISOString();
        const result = await tx.run(`CREATE (p:TutorPayoutBatch {id:$id,tutorId:$tutorId,currency:'USD',policy:$policy,status:'reserved',
          recipient:$recipient,bookingIdsJson:$ids,earningsJson:$earnings,totalCents:$total,feeCents:0,approvedBy:$actorId,
          reason:$reason,createdAt:$now,expiresAt:$expiry,zkVerified:false,transferEnabled:false})
          WITH p MATCH (e:TutorEarning) WHERE e.bookingId IN $bookingIds AND e.tutorId=$tutorId
          SET e.status='reserved',e.payoutBatchId=$id CREATE (p)-[:RESERVES_EARNING]->(e) RETURN p LIMIT 1`,
        { id: input.requestId, tutorId, policy: PAYOUT_POLICY, recipient: input.recipient, ids: JSON.stringify(input.bookingIds),
          earnings: JSON.stringify(earnings), total: int(total), actorId, reason: input.reason, now,
          expiry: new Date(Date.parse(now) + 3600_000).toISOString(), bookingIds: input.bookingIds });
        return { batch: plainNode(result.records[0]!.get('p').properties), replayed: false };
      });
    } catch (e) { return financialFailure(e); } finally { await session.close(); }
  }

  async evidence(tutorId: string, id: string, actorId: string) {
    compensationTutorId(tutorId); compensationTutorId(id); const session = getDriver().session();
    try {
      return await session.executeWrite(async tx => {
        await finance(tx, actorId); await lockTutor(tx, tutorId);
        const row = (await tx.run('MATCH (p:TutorPayoutBatch {id:$id,tutorId:$tutorId}) RETURN p', { id, tutorId })).records[0];
        const batch = row && plainNode(row.get('p').properties);
        if (!batch || batch.status !== 'reserved' || Date.parse(batch.expiresAt) <= Date.now()) throw new TutorCompensationError(409, 'Payout reservation is unavailable or expired.');
        const originals = JSON.parse(batch.earningsJson) as Record<string, any>[];
        for (const original of originals) {
          const booking = await lockedBooking(tx, tutorId, original.bookingId);
          const e = (await tx.run('MATCH (e:TutorEarning {bookingId:$bookingId,tutorId:$tutorId}) RETURN e', { bookingId: original.bookingId, tutorId })).records[0]?.get('e')?.properties;
          if (!e || e.payoutBatchId !== id || e.status !== 'reserved' || Number(e.netCents) !== original.netCents
            || Number(e.rateVersion) !== original.rateVersion || payableCompletion(booking) !== original.completionAt) throw new TutorCompensationError(409, 'Reserved earnings changed; authorization is blocked.');
        }
        return { protocol: PAYOUT_POLICY, batch, earnings: originals, zkVerified: false, transferEnabled: false };
      });
    } catch (e) { return financialFailure(e); } finally { await session.close(); }
  }
}
export const tutorEarningsService = new TutorEarningsService();
