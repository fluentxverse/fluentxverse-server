import { strict as assert } from 'node:assert';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';

const uri = process.env.TEST_MEMGRAPH_URI;
if (!uri) throw new Error('TEST_MEMGRAPH_URI is required (use an isolated test database)');

await initDriver(uri, '', '', 12, 1000);
const db = getDriver().session();
const service = new ScheduleService();

try {
  const existing = await db.run('MATCH (n) RETURN count(n) AS total');
  assert.equal(existing.records[0]!.get('total').toNumber(), 0, 'Use an empty isolated database');
  await db.run("CREATE (:User {id: 'unbooked-tutor'})");

  const startMs = Math.ceil((Date.now() + 20 * 60_000) / 60_000) * 60_000;
  const pht = new Date(startMs + 8 * 60 * 60_000).toISOString();
  const date = pht.slice(0, 10);
  const time = pht.slice(11, 16);
  for (const [id, status, present] of [
    ['missed-open', 'open', false],
    ['missed-pending', 'pending', false],
    ['confirmed-open', 'open', true],
    ['confirmed-pending', 'pending', false],
    ['legacy-open', 'open', false]
  ] as const) {
    await db.run(
      `MATCH (t:User {id: 'unbooked-tutor'})
       CREATE (t)-[:OPENS_SLOT]->(s:TimeSlot {slotId: $id, tutorId: 'unbooked-tutor',
         slotDate: $date, slotTime: $time, status: $status,
         attendanceAutoEnforce: $enforce,
         attendanceMarked: $attendance, pendingBy: $pendingBy,
         pendingUntil: datetime($pendingUntil), reservationId: $reservationId})`,
      {
        id, date, time, status, enforce: id === 'legacy-open' ? null : true,
        attendance: present ? 'present' : null,
        pendingBy: status === 'pending' ? 'checkout-student' : null,
        pendingUntil: new Date(Date.now() + 7 * 60_000).toISOString(),
        reservationId: status === 'pending' ? `hold-${id}` : null
      }
    );
  }
  const futurePht = new Date(startMs + 2 * 60 * 60_000 + 8 * 60 * 60_000).toISOString();
  await db.run(
    `MATCH (t:User {id: 'unbooked-tutor'})
     CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId: 'future-legacy', tutorId: 'unbooked-tutor',
       slotDate: $date, slotTime: $time, status: 'open'})`,
    { date: futurePht.slice(0, 10), time: futurePht.slice(11, 16) }
  );
  const pastPht = new Date(startMs - 15 * 60_000 + 8 * 60 * 60_000).toISOString();
  await db.run(
    `MATCH (t:User {id: 'unbooked-tutor'})
     CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId: 'past-legacy', tutorId: 'unbooked-tutor',
       slotDate: $date, slotTime: $time, status: 'open'})`,
    { date: pastPht.slice(0, 10), time: pastPht.slice(11, 16) }
  );

  await service.markTutorAttendance({
    tutorId: 'unbooked-tutor', bookingIds: [], slotIds: ['confirmed-pending'], status: 'present'
  });
  await service.enableAutoAttendanceForUpcomingOpenSlots();
  const seeded = await db.run(
    `MATCH (s:TimeSlot) WHERE s.slotId IN ['legacy-open', 'future-legacy', 'past-legacy']
     RETURN s.slotId AS id, s.attendanceAutoEnforce AS enforce`
  );
  const seedState = new Map(seeded.records.map(record => [record.get('id'), record.get('enforce')]));
  assert.equal(seedState.get('legacy-open'), true);
  assert.equal(seedState.get('future-legacy'), true);
  assert.equal(seedState.get('past-legacy'), null);
  assert.equal(await service.reconcileMissedOpenSlotAttendance(new Date(startMs - 11 * 60_000)), 0);
  assert.equal(await service.reconcileMissedOpenSlotAttendance(new Date(startMs - 11 * 60_000 + 1)), 3);
  await db.run(
    `UNWIND range(1, 205) AS i
     MATCH (t:User {id: 'unbooked-tutor'})
     CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId: 'bulk-' + toString(i), tutorId: 'unbooked-tutor',
       slotDate: $date, slotTime: $time, status: 'open', attendanceAutoEnforce: true})`,
    { date, time }
  );
  assert.equal(await service.reconcileMissedOpenSlotAttendance(new Date(startMs - 11 * 60_000 + 1)), 205);
  assert.equal(await service.reconcileMissedOpenSlotAttendance(new Date(startMs - 10 * 60_000)), 0);

  const result = await db.run(
    `MATCH (s:TimeSlot {tutorId: 'unbooked-tutor'})
     OPTIONAL MATCH (p:Penalty {slotId: s.slotId, penaltyCode: '302'})
     RETURN s.slotId AS id, s.status AS status, s.penaltyCode AS code,
            s.pendingBy AS pendingBy, s.reservationId AS reservationId,
            s.attendanceMarked AS attendance, count(p) AS penalties`
  );
  const rows = new Map(result.records.map(record => [record.get('id'), record]));
  for (const id of ['missed-open', 'missed-pending', 'legacy-open', 'bulk-205']) {
    const row = rows.get(id)!;
    assert.equal(row.get('status'), 'available');
    assert.equal(row.get('code'), '302');
    assert.equal(row.get('attendance'), 'absent');
    assert.equal(row.get('penalties').toNumber(), 1);
    assert.equal(row.get('pendingBy'), null);
    assert.equal(row.get('reservationId'), null);
  }
  for (const id of ['confirmed-open', 'confirmed-pending']) {
    const row = rows.get(id)!;
    assert.notEqual(row.get('status'), 'available');
    assert.equal(row.get('attendance'), 'present');
    assert.equal(row.get('penalties').toNumber(), 0);
  }
  assert.equal(rows.get('past-legacy')!.get('status'), 'open');
  assert.equal(rows.get('past-legacy')!.get('penalties').toNumber(), 0);
  assert.equal(rows.get('future-legacy')!.get('status'), 'open');
  await db.run(
    `MATCH (t:User {id: 'unbooked-tutor'})
     CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId: 'expired-pending', tutorId: 'unbooked-tutor',
       slotDate: $date, slotTime: $time, status: 'pending', attendanceAutoEnforce: true,
       pendingBy: 'checkout-student', reservationId: 'expired-hold', pendingUntil: datetime($expired)})`,
    { date, time, expired: new Date(Date.now() - 1_000).toISOString() }
  );
  const visible: string[] = [];
  for (const weekOffset of [0, 1]) {
    const schedule = await service.getTutorSchedule({ tutorId: 'unbooked-tutor', weekOffset });
    visible.push(...schedule.slots.filter(slot => slot.slotId === 'expired-pending').map(slot => slot.status));
  }
  assert.deepEqual(visible, ['open']);
  await service.markTutorAttendance({
    tutorId: 'unbooked-tutor', bookingIds: [], slotIds: ['expired-pending'],
    status: 'absent', reason: 'Emergency'
  });
  const expired = await db.run(
    `MATCH (s:TimeSlot {slotId: 'expired-pending'})
     RETURN s.status AS status, s.penaltyCode AS code, s.reservationId AS reservationId`
  );
  assert.equal(expired.records[0]!.get('status'), 'available');
  assert.equal(expired.records[0]!.get('code'), '303');
  assert.equal(expired.records[0]!.get('reservationId'), null);
  await db.run("MATCH (s:TimeSlot) WHERE s.slotId <> 'missed-open' DETACH DELETE s");
  await assert.rejects(
    service.openSlots({ tutorId: 'unbooked-tutor', slots: [{ date, time }] }),
    /TA-302 slot cannot be reopened/
  );
} finally {
  await db.close();
  await closeDriver();
}
