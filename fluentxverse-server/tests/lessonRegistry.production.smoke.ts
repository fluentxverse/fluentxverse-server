// Operator-only production check: one opaque synthetic receipt, no participants, payment, or actual lesson.
import assert from 'node:assert/strict';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { captureBooking, ensureRegistryOutbox, registryConfig, registryEvents, registryCommitment } from '../src/services/lessonRegistry/outbox';
import production from '../../shared/lessonRegistryDeployment.json';
if (process.env.NODE_ENV !== 'production' || registryConfig()?.binding !== `${production.chainId}:${production.contract}`)
  throw Error('Pinned production configuration required');
await initDriver(process.env.MEMGRAPH_URI!, process.env.MEMGRAPH_USER || '', process.env.MEMGRAPH_PASSWORD || '', 1);
const db = getDriver().session(), id = 'registry-mainnet-synthetic-20261104';
try {
  await ensureRegistryOutbox();
  if (!(await db.run('MATCH(b:LessonRegistrySmoke {bookingId:$id}) RETURN b', { id })).records.length) {
    await db.executeWrite(async tx => {
      // No User, Student, TimeSlot or payment relationship exists. Remove Booking label before commit so jobs cannot mistake this for a real lesson.
      await tx.run(`CREATE(:Booking {bookingId:$id,studentId:'synthetic-no-account',tutorId:'synthetic-no-account',
        status:'confirmed',slotId:'synthetic-no-slot',slotDateTime:datetime($at),durationMinutes:25,paymentMethod:'none'})`, { id, at: new Date().toISOString() });
      await captureBooking(tx, id, 'booking');
      await tx.run('MATCH(b:Booking {bookingId:$id}) SET b:LessonRegistrySmoke REMOVE b:Booking', { id });
    });
  }
  const privateRecord = (await db.run('MATCH(b:LessonRegistrySmoke {bookingId:$id})-[:HAS_REGISTRY_EVENT]->(e:LessonRegistryEvent) RETURN b,e', { id })).records[0]!;
  const b = privateRecord.get('b').properties, e = privateRecord.get('e').properties, payload = JSON.parse(e.json);
  assert.equal(registryCommitment(registryConfig()!, b.registryKey, 1, 'FXV_BOOKING_RECEIPT_V1', e.artifact, e.salt), payload.commitment);
  const response = await fetch('http://127.0.0.1:8765/internal/lesson-registry/events?after=' + (payload.sequence - 1), {
    headers: { 'X-FXV-Dispute-Feed-Key': process.env.LESSON_REGISTRY_FEED_KEY! },
  });
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control')!, /no-store/);
  const page: any = await response.json();
  assert.equal(page.chainId, 42161); assert.equal(page.contract, production.contract);
  assert(page.events.some((event: any) => event.id === payload.id && event.commitment === payload.commitment));
  for (const secret of [e.artifact, e.salt, 'synthetic-no-account']) assert(!JSON.stringify(page).includes(secret));
  const denied = await fetch('http://127.0.0.1:8765/internal/lesson-registry/events');
  assert.equal(denied.status, 404);
  assert(!(await registryEvents(0)).some(event => event.version !== 2));
  console.log(JSON.stringify({ synthetic: true, caseKey: payload.caseKey, commitment: payload.commitment,
    sequence: payload.sequence, kind: payload.kind, privateCommitmentReproduced: true, feedAuthorized: true,
    unauthorizedFeedRejected: true, privateEvidenceExcluded: true, realParticipants: 0, payments: 0 }));
} finally { await db.close(); await closeDriver(); }
