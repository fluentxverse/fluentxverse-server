import { strict as assert } from 'node:assert';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';

const uri = process.env.TEST_MEMGRAPH_URI;
if (!uri) throw new Error('TEST_MEMGRAPH_URI is required (use an isolated test database)');

await initDriver(uri, '', '', 12, 1000);
const db = getDriver().session();
const service = new ScheduleService();
const reconcileFixtureRoomEntry: ScheduleService['reconcileMissedTutorRoomEntry'] = (now, proof) => service.reconcileMissedTutorRoomEntry(now, proof, 'room-tutor');
const startMs = Math.ceil((Date.now() + 2 * 60 * 60_000) / (30 * 60_000)) * 30 * 60_000;
const pht = (ms: number) => new Date(ms + 8 * 60 * 60_000).toISOString();

async function createSlot(id: string, offsetMinutes: number, status: 'booked' | 'open', present: boolean) {
  const slotMs = startMs + offsetMinutes * 60_000;
  const local = pht(slotMs);
  await db.run(
    `MATCH (t:User {id: 'room-tutor'})
     CREATE (s:TimeSlot {slotId: $id, tutorId: 'room-tutor', status: $status,
                         slotDate: $date, slotTime: $time,
                         attendanceMarked: $slotAttendance})
     CREATE (t)-[:OPENS_SLOT]->(s)
     FOREACH (_ IN CASE WHEN $status = 'booked' THEN [1] ELSE [] END |
       CREATE (b:Booking {bookingId: $id, tutorId: 'room-tutor', status: 'confirmed',
                          attendanceTutor: $bookingAttendance,
                          roomEntryPolicyActivatedAt: datetime($activatedAt),
                          slotDateTime: datetime($startsAt)})
       CREATE (b)-[:BOOKS]->(s))`,
    {
      id, status, date: local.slice(0, 10), time: local.slice(11, 16),
      slotAttendance: status === 'open' && present ? 'present' : null,
      bookingAttendance: status === 'booked' && present ? 'present' : null,
      activatedAt: new Date(startMs - 35 * 60_000).toISOString(),
      startsAt: new Date(slotMs).toISOString()
    }
  );
}

try {
  const existing = await db.run('MATCH (n) RETURN count(n) AS total');
  assert.equal(existing.records[0]?.get('total').toNumber(), 0, 'Use an empty isolated database');
  await db.run("CREATE (:User {id: 'room-tutor'})");
  await createSlot('missed', 0, 'booked', true);
  await createSlot('next-open', 30, 'open', true);
  await createSlot('next-booked', 60, 'booked', true);
  await createSlot('gap', 90, 'open', false);
  await createSlot('after-gap', 120, 'open', true);
  const soonOffset = (Math.ceil((Date.now() + 60_000) / 60_000) * 60_000 - startMs) / 60_000;
  await createSlot('joined', soonOffset, 'booked', true);
  await createSlot('activity-proof', 25 * 60, 'booked', true);

  assert.equal(await service.markTutorRoomEntry('joined', 'wrong-tutor'), false);
  await db.run(
    "MATCH (b:Booking {bookingId: 'joined'}) SET b.tutorRoomEnteredAt = datetime($early)",
    { early: new Date(startMs + soonOffset * 60_000 - 60 * 60_000).toISOString() }
  );
  assert.equal(await service.markTutorRoomEntry('joined', 'room-tutor', new Date(startMs + soonOffset * 60_000)), true);
  assert.equal(await reconcileFixtureRoomEntry(
    new Date(startMs + 4 * 60_000), async () => false
  ), 0, 'no-show penalties wait until the scheduled lesson ends');
  const missed = await reconcileFixtureRoomEntry(
    new Date(startMs + 25 * 60_000), async () => false
  );
  assert.equal(missed, 1);
  const fakeNow = new Date(startMs + 26 * 60 * 60_000);
  const checked: string[] = [];
  const laterMissed = await reconcileFixtureRoomEntry(fakeNow, async bookingId => {
    checked.push(bookingId);
    return bookingId === 'activity-proof';
  });
  assert.equal(laterMissed, 1);
  assert.equal(checked.includes('activity-proof'), true);
  assert.equal(checked.includes('joined'), false, 'a verified room entry is not reconsidered');
  const state = await db.run(
    `MATCH (s:TimeSlot) WHERE s.slotId IN $ids
     OPTIONAL MATCH (b:Booking)-[:BOOKS]->(s)
     RETURN s.slotId AS id, s.attendanceMarked AS slotAttendance,
            b.attendanceTutor AS bookingAttendance, b.penaltyCode AS penaltyCode`,
    { ids: ['missed', 'next-open', 'next-booked', 'gap', 'after-gap', 'joined', 'activity-proof'] }
  );
  const byId = new Map(state.records.map(record => [record.get('id'), record]));
  assert.equal(byId.get('missed')?.get('bookingAttendance'), 'absent');
  assert.equal(byId.get('missed')?.get('penaltyCode'), '301');
  assert.equal(byId.get('next-open')?.get('slotAttendance'), 'present');
  assert.equal(byId.get('next-booked')?.get('bookingAttendance'), 'absent');
  assert.equal(byId.get('after-gap')?.get('slotAttendance'), 'present');
  assert.equal(byId.get('joined')?.get('bookingAttendance'), 'present');
  assert.equal(byId.get('activity-proof')?.get('bookingAttendance'), 'present');
  assert.equal(await reconcileFixtureRoomEntry(fakeNow, async () => false), 0);

  await createSlot('late-missed', 48 * 60, 'booked', true);
  await createSlot('late-next', 48 * 60 + 30, 'booked', true);
  assert.equal(await reconcileFixtureRoomEntry(
    new Date(startMs + (48 * 60 + 25) * 60_000), async () => false
  ), 1);
  const lateNext = await db.run(
    "MATCH (b:Booking {bookingId: 'late-next'}) RETURN b.attendanceTutor AS attendance"
  );
  assert.equal(lateNext.records[0]?.get('attendance'), 'present',
    'a delayed job must not reset attendance after reconfirmation has closed');
} finally {
  await db.close();
  await closeDriver();
}
