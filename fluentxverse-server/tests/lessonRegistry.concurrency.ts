import assert from 'node:assert/strict';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { ensureRegistryOutbox, captureBooking, registryEvents } from '../src/services/lessonRegistry/outbox';
if (process.env.REGISTRY_TEST_URI !== 'bolt://127.0.0.1:17739') throw Error('Disposable graph required');
process.env.LESSON_REGISTRY_CAPTURE = 'true';
process.env.LESSON_REGISTRY_CHAIN_ID = '421614';
process.env.LESSON_REGISTRY_CONTRACT = '0x' + '2'.repeat(40);
await initDriver(process.env.REGISTRY_TEST_URI, '', '', 1);
const db = getDriver().session();
try {
  assert.equal(Number((await db.run("MATCH(u:User {id:'registry-tutor'}) RETURN count(u) AS n")).records[0]!.get('n')), 1);
  await ensureRegistryOutbox();
  await Promise.all(['race-one', 'race-two'].map(async bookingId => {
    const session = getDriver().session();
    try {
      await session.executeWrite(async tx => {
        await tx.run(`CREATE(:Booking {bookingId:$bookingId,status:'confirmed',studentId:'synthetic-student',tutorId:'synthetic-tutor',
          slotDateTime:datetime($at),durationMinutes:25})`, { bookingId, at: new Date().toISOString() });
        await captureBooking(tx, bookingId, 'booking');
      });
    } finally { await session.close(); }
  }));
  assert.deepEqual((await registryEvents(0)).map(e => e.sequence), [1, 2]);
  const status = async () => (await db.run("MATCH(b:Booking {bookingId:'race-one'}) RETURN b.status AS status")).records[0]!.get('status');
  const cancel = () => db.executeWrite(async tx => {
    await tx.run("MATCH(b:Booking {bookingId:'race-one'}) SET b.status='cancelled'");
    await captureBooking(tx, 'race-one', 'booking_cancel', { reason: 'Synthetic failure' });
  });
  process.env.LESSON_REGISTRY_CAPTURE = 'false';
  await assert.rejects(cancel(), /binding changed/);
  assert.equal(await status(), 'confirmed');
  process.env.LESSON_REGISTRY_CAPTURE = 'true';
  process.env.LESSON_REGISTRY_CONTRACT = '0x' + '3'.repeat(40);
  await assert.rejects(cancel(), /binding changed/);
  assert.equal(await status(), 'confirmed');
  process.env.LESSON_REGISTRY_CONTRACT = '0x' + '2'.repeat(40);
  await db.run("CREATE(:LessonIssueThread {id:'synthetic-freeze',bookingId:'race-one',registryVersion:1})");
  await assert.rejects(cancel(), /disputed booking/);
  assert.equal(await status(), 'confirmed');
  assert.equal((await registryEvents(0)).length, 2);
  console.log('PASS concurrent commit order, disabled-capture hold, deployment-change hold, and disputed-booking rollback');
} finally { await db.close(); await closeDriver(); }
