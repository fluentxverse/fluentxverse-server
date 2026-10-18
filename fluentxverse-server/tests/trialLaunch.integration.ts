import assert from 'node:assert/strict';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';
import { ticketService } from '../src/services/ticket.services/ticket.service';
import { assertTrialAllowance } from '../src/services/schedule.services/trialPolicy';
import { CancellationRefundService } from '../src/services/ticket.services/cancellationRefund.service';
import { AnonymousReviewRepository } from '../src/services/anonymousReviews/repository';

// Never accepts a runtime URI or uses the production database.
await initDriver('bolt://127.0.0.1:7712', '', '', 10, 500);
process.env.LESSON_BOOKING_MODE = 'trial'; process.env.TRIAL_LESSON_LIMIT = '1';
process.env.LESSON_PASSES_ENABLED = 'true'; process.env.PRIVACY_INFRA_MODE = 'bridge_only';
const db = getDriver().session(), service = new ScheduleService();
const original = [ticketService.verifyTicketTransfer, ticketService.recordTicketDeduction, ticketService.getBookingTransaction];
let ticketCalls = 0;
ticketService.verifyTicketTransfer = async () => { ticketCalls++; throw new Error('Trial attempted a ticket verification'); };
ticketService.recordTicketDeduction = async () => { ticketCalls++; throw new Error('Trial attempted a ticket deduction'); };
ticketService.getBookingTransaction = async () => { ticketCalls++; throw new Error('Trial attempted a ticket refund lookup'); };
const slot = (offset: number) => { const d = new Date(Date.now() + offset * 60000 + 8 * 3600000).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16) }; };
try {
  assert.equal((await db.run('MATCH (n) RETURN count(n) AS total')).records[0]!.get('total').toNumber(), 0, 'Use a fresh disposable database');
  await db.run("CREATE (:User {id:'trial-tutor', writtenExamPassed:true, speakingExamPassed:true, profileStatus:'approved', firstName:'Tutor'})");
  await db.run("CREATE (:User {id:'uncertified-tutor', writtenExamPassed:false, speakingExamPassed:false, profileStatus:'pending'})");
  for (const id of ['trial-student', 'race-student', 'other-student']) await db.run('CREATE (:Student {id:$id, firstName:$id})', { id });
  for (const [id, minutes, tutorId] of [['trial-a', 240, 'trial-tutor'], ['trial-b', 300, 'trial-tutor'], ['race-a', 400, 'trial-tutor'], ['race-b', 500, 'trial-tutor'], ['uncertified', 600, 'uncertified-tutor']] as const) {
    const time = slot(minutes);
    await db.run(`MATCH (t:User {id:$tutorId}) CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId:$id, tutorId:$tutorId,
      slotDate:$date, slotTime:$time, status:'open', durationMinutes:25})`, { id, tutorId, ...time });
  }
  const first = await service.reserveSlotForCheckout('trial-student', 'trial-a');
  const input = { studentId: 'trial-student', slotId: 'trial-a', reservationId: first.reservationId };
  await assert.rejects(service.bookSlot({ ...input, ticketTransferTxHash: 'forged-ticket' }), /do not accept/);
  const booked = await service.bookSlot(input);
  assert.equal((await service.bookSlot(input)).bookingId, booked.bookingId, 'Reservation retries return the original booking');
  assert.equal((await service.reservationStatus('trial-student', first.reservationId)).state, 'booked');
  assert.equal((await service.reservationStatus('other-student', first.reservationId)).state, 'expired', 'Reservation lookup is account-scoped');
  assert.equal((await db.run('MATCH (b:Booking {bookingId:$id}) RETURN b.paymentMethod AS method', { id: booked.bookingId })).records[0]!.get('method'), 'trial');
  const second = await service.reserveSlotForCheckout('trial-student', 'trial-b');
  await assert.rejects(service.bookSlot({ studentId: 'trial-student', slotId: 'trial-b', reservationId: second.reservationId }), /allowance/);
  await service.releaseSlotReservation('trial-student', 'trial-b', second.reservationId);
  const cancelled = await service.cancelBooking({ bookingId: booked.bookingId, cancelledBy: 'trial-student' });
  assert.equal(cancelled.refunded, false); assert.match(cancelled.message, /trial lesson is available/);
  await assertTrialAllowance(db as any, 'trial-student');
  const replacement = await service.reserveSlotForCheckout('trial-student', 'trial-b');
  const replacementBooking = await service.bookSlot({ studentId: 'trial-student', slotId: 'trial-b', reservationId: replacement.reservationId });
  await db.run(`MATCH (b:Booking {bookingId:$id}) SET b.status='cancelled', b.cancelledAt=b.slotDateTime-duration('PT30M'), b.cancelledBy='trial-student'`, { id: replacementBooking.bookingId });
  await assert.rejects(assertTrialAllowance(db as any, 'trial-student'), /allowance/);
  await db.run("MATCH (b:Booking {bookingId:$id}) SET b.cancelledBy='support'", { id: replacementBooking.bookingId });
  await assertTrialAllowance(db as any, 'trial-student');
  assert.equal(await new CancellationRefundService().process(replacementBooking.bookingId), null);
  const bad = await service.reserveSlotForCheckout('other-student', 'uncertified');
  await assert.rejects(service.bookSlot({ studentId: 'other-student', slotId: 'uncertified', reservationId: bad.reservationId }), /not yet certified/);
  const holds = await Promise.all(['race-a', 'race-b'].map(id => service.reserveSlotForCheckout('race-student', id)));
  const race = await Promise.allSettled(holds.map((hold, i) => service.bookSlot({ studentId: 'race-student', slotId: ['race-a', 'race-b'][i]!, reservationId: hold.reservationId })));
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1, 'Concurrent bookings cannot exceed the trial limit');
  assert.equal((await db.run("MATCH (b:Booking {studentId:'race-student'}) RETURN count(b) AS total")).records[0]!.get('total').toNumber(), 1);
  assert.equal(ticketCalls, 0, 'No ticket or wallet service participates in trial bookings or cancellation');
  const reviews = new AnonymousReviewRepository(), opensAt = new Date(Date.now() - 3600000).toISOString(), closesAt = new Date(Date.now() + 3600000).toISOString();
  await reviews.read(`CREATE (:AnonymousReviewCohort {id:'bridge-fixture', root:'1', activationStatus:'active_bridge', opensAt:$opensAt, closesAt:$closesAt})`, { opensAt, closesAt });
  await reviews.saveSubmission({ id: 'bridge-review', groupId: 'bridge-fixture', nullifier: '2', status: 'awaiting_horizen',
    proofJson: '{"message":"3"}', encryptedContent: '' });
  const receipt = JSON.stringify({ aggregationId: '1215', merklePath: [], leafCount: '1', index: '0' });
  await assert.rejects(reviews.acceptBridge('bridge-review', receipt), /awaiting/);
  await reviews.patch('bridge-review', { zkVerifyTx: `0x${'a'.repeat(64)}` });
  const competing = await Promise.allSettled([reviews.acceptBridge('bridge-review', receipt), reviews.acceptBridge('bridge-review', receipt.replace('1215', '1216'))]);
  assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1, 'Concurrent receipt records cannot replace each other');
  const accepted = (await reviews.submission('bridge-review'))!;
  assert.equal(accepted.status, 'verified'); assert(Number.isFinite(Date.parse(accepted.acceptedAt!)));
  await reviews.acceptBridge('bridge-review', accepted.receiptJson!);
  assert.equal((await reviews.submission('bridge-review'))!.acceptedAt, accepted.acceptedAt, 'Acceptance timestamp is immutable');
  await reviews.read("MATCH (g:AnonymousReviewCohort {id:'bridge-fixture'}) SET g.closesAt=$closesAt", { closesAt: new Date(Date.now() - 1000).toISOString() });
  await assert.rejects(reviews.acceptBridge('bridge-review', accepted.receiptJson!), /closed/);
  console.log('PASS trial database integration: wallet-free booking, idempotency, allowance race, cancellation, legacy isolation and tutor eligibility');
  console.log('PASS bridge acceptance persistence: prerequisite checks, concurrency, immutable receipts/timestamps and closed windows; proof/bridge verification covered separately');
} finally {
  [ticketService.verifyTicketTransfer, ticketService.recordTicketDeduction, ticketService.getBookingTransaction] = original as any;
  await db.close(); await closeDriver();
}
