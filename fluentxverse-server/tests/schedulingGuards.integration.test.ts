import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';
import { ticketService } from '../src/services/ticket.services/ticket.service';
import { LessonIssueReviewService } from '../src/services/lessonIssueReview.service';
import { reconcileTutorPenaltyBlock } from '../src/services/schedule.services/tutorPenaltyBlock';

const suite = process.env.SCHEDULING_TEST_URI ? describe : describe.skip;
const prefix = `scheduling-guard-${crypto.randomUUID()}`;
const id = (name: string) => `${prefix}-${name}`;
const start = Math.ceil((Date.now() + 7200000) / 1800000) * 1800000;
const service = new ScheduleService();
const run = async (cypher: string, params: Record<string, any> = {}) => {
  const db = getDriver().session(); try { return await db.run(cypher, params); } finally { await db.close(); }
};
async function slot(name: string, tutor: string, minutes = 0) {
  const local = new Date(start + minutes * 60000 + 8 * 3600000).toISOString();
  const result = await service.openSlots({ tutorId: id(tutor), slots: [{ date: local.slice(0, 10), time: local.slice(11, 16) }] });
  return result[0]!;
}
async function booking(name: string, student: string, tutor: string, minutes = 0) {
  const timeSlot = await slot(name, tutor, minutes);
  const hold = await service.reserveSlotForCheckout(id(student), timeSlot.slotId);
  return service.bookSlot({ studentId: id(student), slotId: timeSlot.slotId, reservationId: hold.reservationId, ticketTransferTxHash: id(name) });
}

suite('scheduling guards and attendance correction', () => {
  let verify: ReturnType<typeof spyOn>, record: ReturnType<typeof spyOn>;
  beforeAll(async () => {
    await initDriver(process.env.SCHEDULING_TEST_URI!, '', '', 1);
    await run(`UNWIND $tutors AS tutor CREATE (:User {id: tutor, email: 'paulanthonyarriola@gmail.com'})`,
      { tutors: ['a', 'b', 'c', 'blocked', 'corrected', 'manual'].map(id) });
    await run('UNWIND $students AS student CREATE (:Student {id: student, externalWalletAddress: $wallet})',
      { students: ['student', 'race', 'blocked-student', 'late'].map(id), wallet: '0x1111111111111111111111111111111111111111' });
    verify = spyOn(ticketService, 'verifyTicketTransfer').mockResolvedValue({ valid: true, tier: 'basic' });
    record = spyOn(ticketService, 'recordTicketDeduction').mockResolvedValue({} as never);
  });
  afterAll(async () => {
    verify?.mockRestore(); record?.mockRestore();
    await run(`MATCH (n) WHERE n.id STARTS WITH $prefix OR n.tutorId STARTS WITH $prefix OR n.studentId STARTS WITH $prefix
      OR n.actorId STARTS WITH $prefix OR n.bookingId STARTS WITH $prefix OR n.userId STARTS WITH $prefix DETACH DELETE n`, { prefix });
    await closeDriver();
  });
  test('a booked student cannot reserve another tutor at an overlapping time; adjacent lessons work', async () => {
    await booking('first', 'student', 'a');
    const overlap = await slot('overlap', 'b', 0);
    await expect(service.reserveSlotForCheckout(id('student'), overlap.slotId)).rejects.toThrow('already have a lesson');
    const adjacent = await slot('adjacent', 'b', 25);
    const hold = await service.reserveSlotForCheckout(id('student'), adjacent.slotId);
    await service.releaseSlotReservation(id('student'), adjacent.slotId, hold.reservationId);
  });
  test('simultaneous holds across tutors allow only one overlapping checkout', async () => {
    const first = await slot('race-a', 'a', 60), second = await slot('race-b', 'b', 60);
    const results = await Promise.allSettled([service.reserveSlotForCheckout(id('race'), first.slotId), service.reserveSlotForCheckout(id('race'), second.slotId)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  });
  test('final booking rechecks overlap even for legacy holds created before guards', async () => {
    const first = await slot('final-a', 'a', 120), second = await slot('final-b', 'b', 120);
    await run(`MATCH (s:TimeSlot) WHERE s.slotId IN $slots SET s.status = 'pending', s.pendingBy = $student,
      s.pendingUntil = datetime($until), s.reservationId = s.slotId`, { slots: [first.slotId, second.slotId], student: id('late'), until: new Date(Date.now() + 420000).toISOString() });
    // Remove the other hold once its booking becomes confirmed, simulating a previously acquired checkout.
    await run(`MATCH (s:TimeSlot {slotId: $slot}) REMOVE s.pendingBy`, { slot: second.slotId });
    await service.bookSlot({ studentId: id('late'), slotId: first.slotId, reservationId: first.slotId, ticketTransferTxHash: id('final-first') });
    await run(`MATCH (s:TimeSlot {slotId: $slot}) SET s.pendingBy = $student`, { slot: second.slotId, student: id('late') });
    await expect(service.bookSlot({ studentId: id('late'), slotId: second.slotId, reservationId: second.slotId, ticketTransferTxHash: id('final-second') })).rejects.toThrow('already have a lesson');
  });
  test('blocks hide availability, prevent opening, reservation and final booking, but keep booked room access', async () => {
    const booked = await booking('protected', 'blocked-student', 'blocked');
    const heldSlot = await slot('held', 'blocked', 60);
    const hold = await service.reserveSlotForCheckout(id('blocked-student'), heldSlot.slotId);
    await run('MATCH (t:User {id: $tutor}) SET t.isBlocked = true, t.blockExpiresAt = datetime($until)', { tutor: id('blocked'), until: new Date(Date.now() + 86400000).toISOString() });
    expect((await service.getSchedulingBlock(id('blocked'))).active).toBe(true);
    expect(await service.getAvailableSlots(id('blocked'), heldSlot.date, heldSlot.date)).toHaveLength(0);
    await expect(slot('new', 'blocked', 120)).rejects.toThrow('temporarily blocked');
    await expect(service.reserveSlotForCheckout(id('blocked-student'), heldSlot.slotId)).rejects.toThrow('temporarily blocked');
    await expect(service.bookSlot({ studentId: id('blocked-student'), slotId: heldSlot.slotId, reservationId: hold.reservationId, ticketTransferTxHash: id('blocked-transfer') })).rejects.toThrow('temporarily blocked');
    expect(await service.getClassroomSchedule(booked.bookingId, id('blocked'), 'tutor')).not.toBeNull();
    await run('MATCH (t:User {id: $tutor}) SET t.blockExpiresAt = datetime($until)', { tutor: id('blocked'), until: new Date(Date.now() - 1000).toISOString() });
    await slot('expired-block', 'blocked', 120);
  });
  test('admin corrections revoke and restore penalties, recalculate automatic blocks and retain manual blocks', async () => {
    for (const tutor of ['corrected', 'manual']) {
      await run(`MATCH (t:User {id: $tutor}) UNWIND [1, 2, 3] AS i
        CREATE (b:Booking {bookingId: $tutor + '-lesson-' + toString(i), tutorId: $tutor, status: 'completed', attendanceTutor: 'absent'})
        CREATE (t)-[:HAS_PENALTY]->(:Penalty {penaltyId: $tutor + '-penalty-' + toString(i), tutorId: $tutor,
          bookingId: b.bookingId, penaltyCode: '301', createdAt: datetime()})`, { tutor: id(tutor) });
      const db = getDriver().session(); try { await db.executeWrite(tx => reconcileTutorPenaltyBlock(tx, id(tutor))); } finally { await db.close(); }
    }
    await run(`MATCH (t:User {id: $tutor}) CREATE (t)-[:HAS_PENALTY]->(:Penalty {penaltyId: $id, tutorId: $tutor,
      penaltyCode: '601', penaltyReason: 'Administrator restriction', blockUntil: datetime($until)})`,
      { tutor: id('manual'), id: id('manual-block'), until: new Date(Date.now() + 86400000).toISOString() });
    const reviews = new LessonIssueReviewService();
    await reviews.correctAttendance(`${id('corrected')}-lesson-1`, id('admin'), 'present', 'Connection evidence verified', 'tutor');
    expect((await service.getSchedulingBlock(id('corrected'))).active).toBe(false);
    const penalty = (await run('MATCH (p:Penalty {bookingId: $booking, penaltyCode: \'301\'}) RETURN p', { booking: `${id('corrected')}-lesson-1` })).records[0]!.get('p').properties;
    expect(penalty.status).toBe('voided');
    await reviews.correctAttendance(`${id('manual')}-lesson-1`, id('admin'), 'present', 'Verified', 'tutor');
    expect((await service.getSchedulingBlock(id('manual'))).active).toBe(true);
    await reviews.correctAttendance(`${id('corrected')}-lesson-1`, id('admin'), 'absent', 'Evidence corrected', 'tutor');
    expect((await service.getSchedulingBlock(id('corrected'))).active).toBe(true);
    expect((await run('MATCH (p:Penalty {bookingId: $booking, penaltyCode: \'301\'}) RETURN p.status AS status', { booking: `${id('corrected')}-lesson-1` })).records[0]!.get('status')).toBe('active');
  });
  test('a completed lesson can be rejoined during wrap-up without granting attendance for late-only entry', async () => {
    const b = (await run('MATCH (b:Booking {ticketTransferTxHash: $hash}) SET b.status = \'completed\' RETURN b', { hash: id('protected') })).records[0]!.get('b').properties;
    expect(await service.getClassroomSchedule(b.bookingId, id('blocked-student'), 'student')).not.toBeNull();
    expect(await service.canStudentJoinRoom(b.bookingId, id('blocked-student'))).toBe(true);
    await service.markTutorRoomEntry(b.bookingId, id('blocked'), new Date(start + 26 * 60000));
    expect((await run('MATCH (b:Booking {bookingId: $id}) RETURN b.tutorRoomAttendedAt AS proof', { id: b.bookingId })).records[0]!.get('proof')).toBeNull();
    expect(await service.reconcileMissedTutorRoomEntry(new Date(start + 26 * 60000), async () => false, id('blocked'))).toBe(1);
  });
  test('cancellation frees the student time while live legacy checkout holds still prevent overlap', async () => {
    await run(`MATCH (b:Booking {ticketTransferTxHash: $hash}) SET b.status = 'cancelled'`, { hash: id('first') });
    const other = await slot('after-cancel', 'b');
    const hold = await service.reserveSlotForCheckout(id('student'), other.slotId);
    await service.releaseSlotReservation(id('student'), other.slotId, hold.reservationId);
    await run(`MATCH (s:TimeSlot {slotId: $slot}) SET s.status = 'pending', s.pendingBy = $student,
      s.pendingAt = datetime() REMOVE s.pendingUntil`, { slot: other.slotId, student: id('student') });
    const conflicting = await slot('legacy-conflict', 'c');
    await expect(service.reserveSlotForCheckout(id('student'), conflicting.slotId)).rejects.toThrow('Another checkout overlaps');
  });
  test('revoking an automatic block preserves an indefinite administrator restriction', async () => {
    await run(`MATCH (t:User {id: $tutor}) CREATE (t)-[:HAS_PENALTY]->(:Penalty {penaltyId: $id,
      tutorId: $tutor, penaltyCode: '601', penaltyReason: 'Administrator restriction'})`, { tutor: id('corrected'), id: id('indefinite') });
    await new LessonIssueReviewService().correctAttendance(`${id('corrected')}-lesson-1`, id('admin'), 'present', 'Evidence verified again', 'tutor');
    const block = await service.getSchedulingBlock(id('corrected'));
    expect(block.active).toBe(true);
    expect(block.expiresAt).toBeNull();
  });
});
