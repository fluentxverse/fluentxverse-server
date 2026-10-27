import { passId, passMessage, passScalar, PASS_MAX_BATCH, type PassAuthorization, type PassAccount } from '../../shared/lessonPasses';
import { passConfig, requirePasses, PassError, parsePassProof, verifyPassProof, validateVault } from './policy';
import { LessonPassRepository, type StoredReservation } from './repository';
import { LessonPassChain } from './chain';
import { type ReviewReceipt, validateReceipt } from '../anonymousReviews/chain';
import { REFUND_POLICY } from '../../config/constant';

const millis = (value: any) => value?.toStandardDate?.().getTime() ?? Date.parse(String(value));
export class LessonPassService {
  constructor(readonly repository = new LessonPassRepository(), readonly chain = new LessonPassChain()) {}
  async mine(studentId: string): Promise<PassAccount> {
    requirePasses(); const result = await this.repository.account(studentId);
    return { vault: result.vault,
      passes: result.passes.map(n => ({ id: n.id, commitment: n.commitment, status: n.status, batchId: n.batchId, origin: n.origin })),
      reservations: result.reservations.map(n => ({ id: n.id, passId: n.passId, root: n.root, refundCommitment: n.refundCommitment,
        deadline: Number(n.deadline), status: n.status, bookingId: n.bookingId })),
      orders: result.orders.map(n => ({ id: n.id, quantity: Number(n.quantity), cents: Number(n.cents), status: n.status })) };
  }
  async saveVault(studentId: string, version: number, envelope: string) {
    requirePasses(); validateVault(envelope);
    if (!Number.isSafeInteger(version) || version < 0) throw new PassError('Invalid vault version');
    return this.repository.saveVault(studentId, version, envelope);
  }
  async order(studentId: string, id: string, sku: string, commitments: string[]) {
    requirePasses(); passId(id); await this.chain.check();
    const order = await this.repository.createOrder(studentId, id, sku, commitments);
    return { id: order.id, quantity: Number(order.quantity), cents: Number(order.cents), status: order.status };
  }
  async approve(id: string, paymentReference: string, paidCents: number, operatorId: string) {
    requirePasses();
    if (!/^[A-Za-z0-9][A-Za-z0-9:._/-]{7,127}$/.test(paymentReference) || !Number.isSafeInteger(paidCents)) throw new PassError('A settled payment reference and exact USD cents are required');
    const order = await this.repository.approveOrder(id, paymentReference, paidCents, operatorId);
    return { id: order.id, status: order.status };
  }
  async batch(id: string) {
    requirePasses(); passId(id); const batch = await this.repository.batch(id);
    if (!batch) throw new PassError('Pass batch not found', 404);
    return { id: batch.id, root: batch.root, members: batch.members, status: batch.status };
  }
  async seal(id: string, passIds: string[]) {
    requirePasses(); passId(id);
    if (!passIds.length || passIds.length > PASS_MAX_BATCH || new Set(passIds).size !== passIds.length) throw new PassError('Invalid pass batch');
    return this.repository.sealBatch(id, [...passIds].sort()).then(batch => ({ id: batch.id, root: batch.root, members: batch.members, status: batch.status }));
  }
  async register(id: string) {
    requirePasses(); const batch = await this.batch(id);
    if (await this.chain.activeBatch(batch.id, batch.root, batch.members.length)) { await this.repository.activateBatch(id); return { status: 'active' }; }
    if (!await this.repository.claim('LessonPassBatch', id, ['sealed'], 'registering')) throw new PassError('Batch registration needs reconciliation', 409);
    const transaction = await this.chain.write('registerBatch', [id, batch.root, batch.members.length]);
    await this.repository.patch('LessonPassBatch', id, { transactionId: transaction.id }); return { status: 'registering', transactionId: transaction.id };
  }
  async prepare(studentId: string, passIdValue: string, id: string, refundCommitment: string) {
    requirePasses(); passId(id); passScalar(refundCommitment);
    const old = await this.repository.reservation(id);
    if (old) {
      if (old.studentId !== studentId || old.passId !== passIdValue || old.refundCommitment !== refundCommitment) throw new PassError('Reservation reference already used', 409);
      return { id: old.id, root: old.root, refundCommitment: old.refundCommitment, deadline: Number(old.deadline), status: old.status };
    }
    const pass = await this.repository.pass(passIdValue);
    if (!pass || pass.studentId !== studentId || !pass.batchId) throw new PassError('Pass not found', 404);
    const batch = await this.batch(pass.batchId);
    if (!await this.chain.activeBatch(batch.id, batch.root, batch.members.length)) throw new PassError('Pass issuance is awaiting finality', 409);
    const authorization: PassAuthorization = { id: id as `0x${string}`, root: batch.root, refundCommitment, deadline: Math.floor(Date.now() / 1000) + 48 * 3600 };
    const saved = await this.repository.authorize(studentId, passIdValue, authorization);
    return { ...authorization, deadline: Number(saved.deadline), status: saved.status };
  }
  async proof(studentId: string, id: string, input: unknown) {
    requirePasses(); const reservation = await this.repository.ownedReservation(studentId, id), c = passConfig();
    if (Date.now() / 1000 > Number(reservation.deadline)) throw new PassError('Pass authorization has expired', 409);
    const proof = parsePassProof(input);
    if (proof.merkleTreeRoot !== reservation.root || proof.scope !== c.scope || proof.message !== passMessage({ ...reservation, deadline: Number(reservation.deadline) })
      || !await verifyPassProof(proof)) throw new PassError('Pass ownership proof does not match its authorization');
    await this.repository.saveProof(id, JSON.stringify(proof), proof.nullifier); return { id, status: 'proof_ready' };
  }
  async submit(id: string) {
    requirePasses(); const reservation = await this.repository.reservation(id);
    if (!reservation?.proofJson) throw new PassError('Generate the pass ownership proof first', 409);
    if (reservation.zkVerifyTx) return { status: reservation.status, txHash: reservation.zkVerifyTx };
    if (Date.now() / 1000 > Number(reservation.deadline)) throw new PassError('Pass authorization has expired', 409);
    if (!await this.repository.claim('LessonPassReservation', id, ['proof_ready'], 'submitting_zkverify')) throw new PassError('Proof submission needs reconciliation; do not blindly retry', 409);
    const result = await this.chain.submit(parsePassProof(JSON.parse(reservation.proofJson)));
    await this.repository.patch('LessonPassReservation', id, { status: 'awaiting_horizen', zkVerifyTx: result.txHash, engineSubmissionId: result.submissionId });
    return { status: 'awaiting_horizen', txHash: result.txHash };
  }
  async certify(id: string, receipt: ReviewReceipt) {
    requirePasses(); validateReceipt(receipt);
    const reservation = await this.repository.reservation(id);
    if (!reservation?.zkVerifyTx || !['awaiting_horizen', 'certifying', 'ready', 'booked'].includes(reservation.status)) throw new PassError('Submit the pass proof first', 409);
    if (await this.chain.state(reservation) === 1) { await this.repository.readyReservation(id); return { status: (await this.repository.reservation(id))!.status }; }
    if (Date.now() / 1000 > Number(reservation.deadline)) throw new PassError('Pass authorization has expired', 409);
    if (!await this.chain.verifiedReceipt(reservation, receipt)) throw new PassError('Pass receipt is not finalized on Horizen', 409);
    await this.repository.saveReceipt(id, JSON.stringify(receipt));
    if (!await this.repository.claim('LessonPassReservation', id, ['awaiting_horizen'], 'certifying')) throw new PassError('Pass certification needs reconciliation', 409);
    const transaction = await this.chain.reserve(reservation, receipt);
    await this.repository.patch('LessonPassReservation', id, { transactionId: transaction.id });
    return { status: 'certifying', transactionId: transaction.id };
  }
  async readyForBooking(studentId: string, id: string) {
    requirePasses(); const reservation = await this.repository.ownedReservation(studentId, id);
    if (reservation.status !== 'ready' || reservation.bookingId || await this.chain.state(reservation) !== 1) throw new PassError('A finalized, unused pass reservation is required', 409);
    await this.repository.ready(); return reservation;
  }
  private finalAction(reservation: StoredReservation, booking: any): 'settle' | 'return' {
    if (!reservation.bookingId) {
      if (!['ready', 'return_requested'].includes(reservation.status)) throw new PassError('Reservation cannot be returned yet', 409);
      return 'return';
    }
    if (!booking || booking.studentId !== reservation.studentId || booking.privatePassReservationId !== reservation.id) throw new PassError('Pass booking binding differs', 409);
    const start = millis(booking.slotDateTime), end = start + Number(booking.durationMinutes || 25) * 60000;
    if (!Number.isFinite(start)) throw new PassError('Booking time is invalid', 409);
    if (booking.refundApprovedBy && booking.refundStatus !== 'review') {
      if (booking.status !== 'cancelled' && Date.now() < end) throw new PassError('Support returns require an ended or cancelled lesson', 409);
      return 'return';
    }
    if (booking.status === 'cancelled') {
      if (booking.cancelledBy !== reservation.studentId) throw new PassError('Support must approve this pass return before finalization', 409);
      const cancelled = millis(booking.cancelledAt);
      if (!Number.isFinite(cancelled)) throw new PassError('Cancellation time is invalid', 409);
      return start - cancelled >= REFUND_POLICY.NO_REFUND_HOURS * 3600000 ? 'return' : 'settle';
    }
    if (booking.status !== 'completed' || Date.now() < end || booking.attendanceStudent !== 'present' || booking.attendanceTutor !== 'present'
      || booking.refundStatus === 'review' || booking.refundApprovedBy || booking.lessonOutcome !== undefined && booking.lessonOutcome !== 'attended')
      throw new PassError('Only finalized payable lessons can settle; other outcomes need support review', 409);
    return 'settle';
  }
  async returnUnused(studentId: string, id: string) {
    requirePasses(); const reservation = await this.repository.ownedReservation(studentId, id);
    if (reservation.bookingId || !['ready', 'return_requested'].includes(reservation.status)) throw new PassError('Only an unused ready reservation can be returned', 409);
    if (reservation.status === 'ready' && !await this.repository.claim('LessonPassReservation', id, ['ready'], 'return_requested')) throw new PassError('Reservation changed; reload', 409);
    return { status: 'return_requested' };
  }
  async finalize(id: string) {
    requirePasses();
    const { reservation, fresh } = await this.repository.beginFinalization(id, (n, booking) => this.finalAction(n, booking));
    if (['settled', 'returned'].includes(reservation.status)) return { status: reservation.status };
    const action = reservation.finalAction!;
    const state = await this.chain.state({ ...reservation, finalAction: action });
    if (state === (action === 'return' ? 3 : 2)) { await this.repository.finalize(id, action); return { status: action === 'return' ? 'returned' : 'settled' }; }
    if (!fresh) throw new PassError('Finalization is pending; reconcile the recorded operation', 409);
    if (state !== 1) throw new PassError('Finalized pass reservation is unavailable', 409);
    const transaction = await this.chain.write(action === 'return' ? 'returnPass' : 'settlePass', [id]);
    await this.repository.patch('LessonPassReservation', id, { transactionId: transaction.id });
    return { status: 'finalizing', transactionId: transaction.id };
  }
  async reconcile(id: string) {
    requirePasses(); const reservation = await this.repository.reservation(id);
    if (!reservation) throw new PassError('Reservation not found', 404);
    if (['finalizing', 'settled', 'returned'].includes(reservation.status)) return this.finalize(id);
    const state = await this.chain.state(reservation);
    if (state === 1 && ['certifying', 'awaiting_horizen'].includes(reservation.status)) await this.repository.readyReservation(id);
    return { id, status: (await this.repository.reservation(id))!.status, finalizedLedgerState: state };
  }
  async recoverUnused(studentId: string, id: string) {
    requirePasses(); const n = await this.repository.ownedReservation(studentId, id);
    if (n.status === 'unused_expired') return { status: n.status };
    if (!['prepared','proof_ready','submitting_zkverify','awaiting_horizen','certifying'].includes(n.status) || n.bookingId)
      throw new PassError('This reservation cannot be recovered as unused', 409);
    // Even a locally prepared proof may have been shared. Wait for finalized expiry.
    if (!await this.chain.expiredUnspent(n)) throw new PassError('Wait for finalized authorization expiry or reconcile its on-chain reservation', 409);
    return this.repository.expireUnused(id, n.status);
  }
}
export const lessonPassService = new LessonPassService();
