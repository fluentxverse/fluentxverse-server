import { strict as assert } from 'node:assert';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';
import { ticketService } from '../src/services/ticket.services/ticket.service';
import { attendanceStartMs } from '../src/services/schedule.services/attendanceWindow';

const uri = process.env.TEST_MEMGRAPH_URI;
process.env.LESSON_BOOKING_MODE = 'paid';
if (!uri) throw new Error('TEST_MEMGRAPH_URI is required (use an isolated test database)');
await initDriver(uri, '', '', 12, 1000);
const db = getDriver().session();
const service = new ScheduleService();
const reconcileFixtureAttendance: ScheduleService['reconcileMissedTutorAttendance'] = (now) => service.reconcileMissedTutorAttendance(now, 'booking-tutor');
const originalVerify = ticketService.verifyTicketTransfer;
const originalRecord = ticketService.recordTicketDeduction;

function phtSlot(minutesAhead: number) {
  const value = new Date(Date.now() + (minutesAhead + 1) * 60_000 + 8 * 60 * 60_000).toISOString();
  return { date: value.slice(0, 10), time: value.slice(11, 16) };
}

try {
  const count = await db.run('MATCH (n) RETURN count(n) AS total');
  assert.equal(count.records[0]!.get('total').toNumber(), 0, 'Use an empty isolated database');
  await db.run("CREATE (:User {id: 'booking-tutor', email: 'paulanthonyarriola@gmail.com'})");
  await db.run("CREATE (:Student {id: 'booking-student', externalWalletAddress: '0x1111111111111111111111111111111111111111'})");
  await db.run("CREATE (:Student {id: 'other-student', externalWalletAddress: '0x2222222222222222222222222222222222222222'})");

  const normal = phtSlot(60);
  const late = phtSlot(8);
  await assert.rejects(service.openSlots({ tutorId: 'booking-tutor', slots: [phtSlot(6)] }), /11 minutes/);
  for (const [id, time, present] of [
    ['normal-slot', normal, false], ['unconfirmed-late', late, false],
    ['confirmed-late', late, true], ['confirmed-normal', phtSlot(100), true]
  ] as const) {
    await db.run(
      `MATCH (t:User {id: 'booking-tutor'})
       CREATE (t)-[:OPENS_SLOT]->(s:TimeSlot {slotId: $id, tutorId: 'booking-tutor',
         slotDate: $date, slotTime: $time, status: 'open', durationMinutes: 30,
         attendanceMarked: $attendance})`,
      { id, date: time.date, time: time.time, attendance: present ? 'present' : null }
    );
  }
  const visible = await service.getAvailableSlots('booking-tutor', normal.date < late.date ? normal.date : late.date,
    normal.date > late.date ? normal.date : late.date);
  assert.deepEqual(new Set(visible.map(slot => slot.slotId)),
    new Set(['normal-slot', 'confirmed-normal', 'confirmed-late']));
  await assert.rejects(service.reserveSlotForCheckout('booking-student', 'unconfirmed-late'), /11 minutes/);
  const lateHold = await service.reserveSlotForCheckout('booking-student', 'confirmed-late');
  assert.equal(typeof lateHold.reservationId, 'string');
  assert.ok(Date.parse(lateHold.bookBy) < Date.parse(lateHold.expiresAt));
  await service.releaseSlotReservation('booking-student', 'confirmed-late', lateHold.reservationId);

  const first = await service.reserveSlotForCheckout('booking-student', 'normal-slot');
  assert.ok(Date.parse(first.bookBy) <= Date.parse(first.expiresAt));
  const same = await service.reserveSlotForCheckout('booking-student', 'normal-slot');
  assert.equal(same.reservationId, first.reservationId);
  await assert.rejects(service.reserveSlotForCheckout('other-student', 'normal-slot'), /available/);
  assert.equal((await service.getAvailableSlots('booking-tutor', normal.date, normal.date))
    .some(slot => slot.slotId === 'normal-slot'), false);
  await service.releaseSlotReservation('other-student', 'normal-slot', first.reservationId);
  assert.equal((await db.run("MATCH (s:TimeSlot {slotId: 'normal-slot'}) RETURN s.status AS status"))
    .records[0]!.get('status'), 'pending');
  await service.releaseSlotReservation('booking-student', 'normal-slot', first.reservationId);
  assert.equal((await db.run("MATCH (s:TimeSlot {slotId: 'normal-slot'}) RETURN s.status AS status"))
    .records[0]!.get('status'), 'open');

  const stale = await service.reserveSlotForCheckout('booking-student', 'normal-slot');
  await db.run("MATCH (s:TimeSlot {slotId: 'normal-slot'}) SET s.pendingUntil = datetime($expired)",
    { expired: new Date(Date.now() - 1000).toISOString() });
  const reclaimed = await service.reserveSlotForCheckout('other-student', 'normal-slot');
  assert.notEqual(reclaimed.reservationId, stale.reservationId);
  await assert.rejects(service.bookSlot({ slotId: 'normal-slot', studentId: 'booking-student',
    reservationId: stale.reservationId, ticketTransferTxHash: 'test-transfer-old' }), /expired/);

  const held = await service.reserveSlotForCheckout('booking-student', 'confirmed-normal');
  ticketService.verifyTicketTransfer = async () => ({ valid: true, tier: 'basic' });
  ticketService.recordTicketDeduction = async () => ({} as never);
  const input = { slotId: 'confirmed-normal', studentId: 'booking-student',
    reservationId: held.reservationId, ticketTransferTxHash: 'test-transfer-confirmed' };
  const booked = await service.bookSlot(input);
  assert.equal(booked.status, 'confirmed');
  assert.equal((await service.bookSlot(input)).bookingId, booked.bookingId);
  await service.releaseSlotReservation('other-student', 'normal-slot', reclaimed.reservationId);
  const secondHold = await service.reserveSlotForCheckout('booking-student', 'normal-slot');
  await assert.rejects(service.bookSlot({ slotId: 'normal-slot', studentId: 'booking-student',
    reservationId: secondHold.reservationId, ticketTransferTxHash: 'test-transfer-confirmed' }), /already been used/);
  await service.releaseSlotReservation('booking-student', 'normal-slot', secondHold.reservationId);
  await db.run(
    `MATCH (t:User {id: 'booking-tutor'})
     CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId: 'race-slot', tutorId: 'booking-tutor',
       slotDate: $date, slotTime: $time, status: 'open', durationMinutes: 30})`,
    { date: normal.date, time: normal.time }
  );
  const contenders = await Promise.allSettled([
    service.reserveSlotForCheckout('booking-student', 'race-slot'),
    service.reserveSlotForCheckout('other-student', 'race-slot')
  ]);
  assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(contenders.filter(result => result.status === 'rejected').length, 1);
  for (const [index, contender] of contenders.entries()) if (contender.status === 'fulfilled') {
    await service.releaseSlotReservation(index === 0 ? 'booking-student' : 'other-student', 'race-slot', contender.value.reservationId);
  }
  await db.run(
    `MATCH (t:User {id: 'booking-tutor'})
     CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId: 'legacy-pending', tutorId: 'booking-tutor',
       slotDate: $date, slotTime: $time, status: 'pending', durationMinutes: 30})`,
    { date: normal.date, time: normal.time }
  );
  assert.equal((await service.getAvailableSlots('booking-tutor', normal.date, normal.date))
    .some(slot => slot.slotId === 'legacy-pending'), true);
  const legacyHold = await service.reserveSlotForCheckout('booking-student', 'legacy-pending');
  assert.equal(typeof legacyHold.reservationId, 'string');
  await service.releaseSlotReservation('booking-student', 'legacy-pending', legacyHold.reservationId);
  await db.run(
    `MATCH (t:User {id: 'booking-tutor'})
     CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId: 'transition-slot', tutorId: 'booking-tutor',
       slotDate: $date, slotTime: $time, status: 'open', durationMinutes: 30})`,
    { date: normal.date, time: normal.time }
  );
  const transitionHold = await service.reserveSlotForCheckout('booking-student', 'transition-slot');
  await db.run(
    `MATCH (s:TimeSlot {slotId: 'transition-slot'}) SET s.slotDate = $date, s.slotTime = $time`,
    { date: late.date, time: late.time }
  );
  await assert.rejects(service.bookSlot({ slotId: 'transition-slot', studentId: 'booking-student',
    reservationId: transitionHold.reservationId, ticketTransferTxHash: 'test-transfer-transition' }), /11 minutes/);
  await db.run("MATCH (s:TimeSlot {slotId: 'transition-slot'}) SET s.attendanceMarked = 'present'");
  const transitioned = await service.bookSlot({ slotId: 'transition-slot', studentId: 'booking-student',
    reservationId: transitionHold.reservationId, ticketTransferTxHash: 'test-transfer-transition' });
  assert.equal((await db.run('MATCH (b:Booking {bookingId: $id}) RETURN b.attendanceTutor AS attendance',
    { id: transitioned.bookingId })).records[0]!.get('attendance'), 'present');
  await service.markTutorRoomEntry(transitioned.bookingId, 'booking-tutor', new Date(attendanceStartMs(late)));
  await db.run(
    `MATCH (t:User {id: 'booking-tutor'})
     CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId: 'recover-cutoff-slot', tutorId: 'booking-tutor',
       slotDate: $date, slotTime: $time, status: 'open', durationMinutes: 30})`,
    { date: normal.date, time: normal.time }
  );
  const cutoffHold = await service.reserveSlotForCheckout('booking-student', 'recover-cutoff-slot');
  assert.equal((await ticketService.recoverUnbookedTransfer('booking-student',
    'test-transfer-cutoff', 'recover-cutoff-slot', cutoffHold.reservationId)).status, 'processing');
  await db.run(
    `MATCH (s:TimeSlot {slotId: 'recover-cutoff-slot'}) SET s.slotDate = $date, s.slotTime = $time`,
    { date: late.date, time: late.time }
  );
  ticketService.verifyTicketTransfer = async () => ({ valid: false, error: 'cutoff reached' });
  await assert.rejects(ticketService.recoverUnbookedTransfer('booking-student',
    'test-transfer-cutoff', 'recover-cutoff-slot', cutoffHold.reservationId), /cutoff reached/);
  ticketService.verifyTicketTransfer = async () => ({ valid: true, tier: 'basic' });
  const result = await db.run(
    `MATCH (b:Booking {bookingId: $bookingId})-[:BOOKS]->(s:TimeSlot)
     RETURN b.attendanceTutor AS attendance, b.attendanceSource AS source,
            s.status AS slotStatus, b.ticketTransferTxHash AS transfer`, { bookingId: booked.bookingId }
  );
  assert.deepEqual(result.records[0]!.toObject(), {
    attendance: 'present', source: 'open_slot_confirmation',
    slotStatus: 'booked', transfer: 'test-transfer-confirmed'
  });
  assert.equal(await reconcileFixtureAttendance(new Date(Date.now() + 50 * 60_000)), 0);
  assert.equal((await ticketService.recoverUnbookedTransfer('booking-student',
    'test-transfer-confirmed', 'confirmed-normal', held.reservationId)).status, 'booked');

  if (process.env.ALLOW_MOCK_TICKET_PURCHASES === 'true') {
    await db.run(
      `MATCH (t:User {id: 'booking-tutor'})
       CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId: 'recovery-slot', tutorId: 'booking-tutor',
         slotDate: $date, slotTime: $time, status: 'open', durationMinutes: 30})
       CREATE (:MockTicketBalance {walletAddress: $wallet, basic: 0})
       CREATE (:MockTicketTransfer {transactionHash: 'mock-ticket-recovery',
         walletAddress: $wallet, studentId: 'booking-student', tier: 'basic',
         quantity: 1, status: 'pending'})`,
      { date: normal.date, time: normal.time, wallet: '0x1111111111111111111111111111111111111111' }
    );
    const recoveryHold = await service.reserveSlotForCheckout('booking-student', 'recovery-slot');
    assert.equal((await ticketService.recoverUnbookedTransfer('booking-student',
      'mock-ticket-recovery', 'recovery-slot', recoveryHold.reservationId)).status, 'processing');
    await db.run("MATCH (s:TimeSlot {slotId: 'recovery-slot'}) SET s.pendingUntil = datetime($expired)",
      { expired: new Date(Date.now() - 1000).toISOString() });
    assert.equal((await ticketService.recoverUnbookedTransfer('booking-student',
      'mock-ticket-recovery', 'recovery-slot', recoveryHold.reservationId)).status, 'refunded');
    assert.equal((await ticketService.recoverUnbookedTransfer('booking-student',
      'mock-ticket-recovery', 'recovery-slot', recoveryHold.reservationId)).status, 'refunded');
    const balance = await db.run('MATCH (b:MockTicketBalance) RETURN b.basic AS basic');
    assert.equal(balance.records[0]!.get('basic').toNumber(), 1);
    await assert.rejects(service.bookSlot({ slotId: 'recovery-slot', studentId: 'booking-student',
      reservationId: recoveryHold.reservationId, ticketTransferTxHash: 'mock-ticket-recovery' }), /expired/);
  }
  console.log('PASS: booking cutoffs, exclusive holds, expiry, idempotency, and tutor confirmation carryover');
} finally {
  ticketService.verifyTicketTransfer = originalVerify;
  ticketService.recordTicketDeduction = originalRecord;
  await db.close();
  await closeDriver();
}
