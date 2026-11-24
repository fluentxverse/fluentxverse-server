import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import Elysia from 'elysia';
import { mock } from 'bun:test';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { captureBooking, ensureRegistryOutbox, registryEvents, registryCommitment, registryConfig } from '../src/services/lessonRegistry/outbox';
import { ensureDisputeOutbox, disputeEvents } from '../src/services/disputeChain/outbox';
import { lessonRegistryRoute } from '../src/routes/lessonRegistry.route';

if (process.env.REGISTRY_TEST_URI !== 'bolt://127.0.0.1:17739') throw Error('Disposable registry test graph required');
// Classroom SQL observations are outside this graph/outbox test. Never connect to a runtime SQL database.
mock.module('../src/db/postgres', () => {
  const query = async () => ({ rows: [], rowCount: 0 });
  return { query, db: async () => [], pool: { query }, getPool: () => ({ query }), closePool: async () => {} };
});
const { ScheduleService } = await import('../src/services/schedule.services/schedule.service');
const { AdminOperationsService } = await import('../src/services/admin.services/operations.service');
const { StudentDisputeService } = await import('../src/services/studentDispute.service');
process.env.LESSON_REGISTRY_CAPTURE = 'true';
process.env.LESSON_REGISTRY_CHAIN_ID = '421614';
process.env.LESSON_REGISTRY_CONTRACT ||= '0x1111111111111111111111111111111111111111';
process.env.LESSON_REGISTRY_FEED_KEY = 'disposable-registry-feed-key-at-least-32-characters';
process.env.DISPUTE_CHAIN_CAPTURE = 'true';
process.env.LESSON_BOOKING_MODE = 'trial';
process.env.TRIAL_LESSON_LIMIT = '10';
process.env.PRIVACY_INFRA_MODE = 'bridge_only';
process.env.BOOKED_ATTENDANCE_RECOVERY_ENABLED = 'false';
await initDriver(process.env.REGISTRY_TEST_URI, '', '', 1);
const db = getDriver().session(), schedule = new ScheduleService(), admin = new AdminOperationsService();
const now = Date.now(), disputes = new StudentDisputeService(() => now);
const student = { id: 'registry-student', role: 'student' as const }, tutor = { id: 'registry-tutor', role: 'tutor' as const };
const countEvents = async () => (await registryEvents(0)).length;
try {
  assert.equal(Number((await db.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n')), 0, 'Use an empty disposable graph');
  await ensureDisputeOutbox();
  await db.run(`CREATE(:User {id:'registry-tutor',writtenExamPassed:true,speakingExamPassed:true,interviewPassed:true,profileStatus:'approved'}),
    (:Student {id:'registry-student'}),(:Admin {id:'registry-support',role:'admin'})`);
  const slot = async (id: string, offset: number) => {
    const date = new Date(now + offset * 60000 + 8 * 3600000).toISOString();
    await db.run(`MATCH(t:User {id:'registry-tutor'}) CREATE(t)-[:OPENS_SLOT]->(:TimeSlot {
      slotId:$id,tutorId:'registry-tutor',slotDate:$date,slotTime:$time,status:'open',durationMinutes:25})`,
      { id, date: date.slice(0, 10), time: date.slice(11, 16) });
  };
  await slot('registry-a', 180); await slot('registry-b', 240); await slot('registry-c', 300);
  const hold = await schedule.reserveSlotForCheckout(student.id, 'registry-a');
  const input = { studentId: student.id, slotId: 'registry-a', reservationId: hold.reservationId };
  const booked = await schedule.bookSlot(input);
  assert.equal((await schedule.bookSlot(input)).bookingId, booked.bookingId);
  assert.equal(await countEvents(), 1, 'Reservation retry emits exactly one receipt');
  await admin.schedule(booked.bookingId, 'registry-support', 'reschedule', 'Synthetic test reschedule', 'registry-b');
  await schedule.cancelBooking({ bookingId: booked.bookingId, cancelledBy: student.id, reason: 'Synthetic test cancellation' });
  assert.deepEqual((await registryEvents(0)).map(e => e.kind), ['booking', 'booking_reschedule', 'booking_cancel']);
  const secondHold = await schedule.reserveSlotForCheckout(student.id, 'registry-c');
  const second = await schedule.bookSlot({ studentId: student.id, slotId: 'registry-c', reservationId: secondHold.reservationId });
  await admin.schedule(second.bookingId, 'registry-support', 'cancel', 'Synthetic support cancellation');

  const seedPast = async (id: string, enrolled = true) => {
    await db.executeWrite(async tx => {
      await tx.run(`MATCH(s:Student {id:'registry-student'}) CREATE(b:Booking {
        bookingId:$id,studentId:'registry-student',tutorId:'registry-tutor',status:'confirmed',paymentMethod:'trial',
        slotId:$id,slotDateTime:datetime($start),durationMinutes:25})-[:BOOKED_BY]->(s)
        CREATE(b)-[:BOOKS]->(:TimeSlot {slotId:$id,status:'booked'})`, { id, start: new Date(now - 30 * 60000).toISOString() });
      if (enrolled) await captureBooking(tx, id, 'booking', {}, new Date(now).toISOString());
    });
  };
  await seedPast('registry-past');
  const first = await disputes.create('registry-past', student.id, 'tutor', 'Synthetic connection concern', 'audio_video');
  assert(first);
  await disputes.reconcile();
  await disputes.reply(first.id, tutor, 'Synthetic timely explanation', [], 'over_ten', 'connection');
  const thread = (await db.run('MATCH(t:LessonIssueThread {id:$id}) RETURN t', { id: first.id })).records[0]!.get('t').properties;
  await disputes.decide(first.id, 'registry-support', 'no_penalty', 'Synthetic reviewed outcome', Number(thread.decisionRevision || 0), false);
  await seedPast('registry-behavior');
  const behavior = await disputes.create('registry-behavior', student.id, 'tutor', 'Synthetic behavior concern', 'inappropriate_behavior');
  assert(behavior);
  const behaviorThread = (await db.run('MATCH(t:LessonIssueThread {id:$id}) RETURN t', { id: behavior.id })).records[0]!.get('t').properties;
  await disputes.decide(behavior.id, 'registry-support', 'no_penalty', 'Synthetic staff-first review', Number(behaviorThread.decisionRevision || 0), false);
  const beforeRollback = await countEvents();
  await assert.rejects(db.executeWrite(async tx => {
    await tx.run(`CREATE(:Booking {bookingId:'rollback',studentId:'registry-student',tutorId:'registry-tutor',status:'confirmed',
      slotDateTime:datetime($start),durationMinutes:25})`, { start: new Date(now).toISOString() });
    await captureBooking(tx, 'rollback', 'booking');
    throw Error('Synthetic rollback');
  }), /Synthetic rollback/);
  assert.equal(await countEvents(), beforeRollback);
  assert.equal(Number((await db.run("MATCH(b:Booking {bookingId:'rollback'}) RETURN count(b) AS n")).records[0]!.get('n')), 0);
  await seedPast('legacy-past', false);
  const legacy = await disputes.create('legacy-past', student.id, 'tutor', 'Legacy synthetic concern', 'audio_video');
  assert(legacy);
  assert.equal(await countEvents(), beforeRollback, 'Legacy reports remain on v1');
  assert((await disputeEvents(0)).length > 0);
  const events = await registryEvents(0);
  assert(events.every((event, i) => event.sequence === i + 1 && event.version === 2));
  for (const key of new Set(events.map(e => e.caseKey))) {
    const subject = events.filter(e => e.caseKey === key);
    assert.equal(subject[0].kind, 'booking');
    assert(subject.every((e, i) => e.caseSequence === i + 1));
  }
  const b = (await db.run("MATCH(b:Booking {bookingId:'registry-past'}) RETURN b")).records[0]!.get('b').properties;
  assert.equal(events.find(e => e.kind === 'open' && e.caseKey === b.registryKey)?.caseKey, b.registryKey);
  const stored = (await db.run('MATCH(e:LessonRegistryEvent) RETURN e ORDER BY e.sequence')).records.map(r => r.get('e').properties);
  for (let i = 0; i < events.length; i++) {
    const event = events[i], privateRecord = stored[i], artifact = JSON.parse(privateRecord.artifact);
    const revision = event.bookingRevision || Number(b.registryRevision);
    const type = event.kind === 'booking_cancel' ? 'FXV_BOOKING_REASON_V1' : event.kind.startsWith('booking') ? 'FXV_BOOKING_RECEIPT_V1' : 'FXV_REGISTRY_DISPUTE_EVENT_V1';
    assert.equal(registryCommitment(registryConfig()!, event.caseKey, revision, type, privateRecord.artifact, privateRecord.salt), event.commitment);
    assert(Array.isArray(artifact));
  }
  const publicJson = JSON.stringify(events);
  for (const secret of ['registry-student', 'registry-tutor', 'Synthetic connection concern', 'Synthetic timely explanation', ...stored.map(e => e.salt)]) assert(!publicJson.includes(secret));
  const app = new Elysia().use(lessonRegistryRoute);
  assert.equal((await app.handle(new Request('http://localhost/internal/lesson-registry/events'))).status, 404);
  const headers = { 'X-FXV-Dispute-Feed-Key': process.env.LESSON_REGISTRY_FEED_KEY };
  assert.equal((await app.handle(new Request('http://localhost/internal/lesson-registry/events?after=-1', { headers }))).status, 400);
  const response = await app.handle(new Request('http://localhost/internal/lesson-registry/events', { headers }));
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control')!, /no-store/);
  assert.equal(((await response.json()) as { events: unknown[] }).events.length, events.length);
  const output = process.env.REGISTRY_FIXTURE_OUTPUT;
  if (output) writeFileSync(output, JSON.stringify({ purpose: 'Synthetic bookings and lesson reports; no real lesson or refund', events, rejections: [] }, null, 2));
  console.log(JSON.stringify({ passed: true, events: events.length, kinds: [...new Set(events.map(e => e.kind))], privateEvidencePublished: false }));
} finally { await db.close(); await closeDriver(); }
