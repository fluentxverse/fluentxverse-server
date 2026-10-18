import { strict as assert } from 'node:assert';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';

const uri = process.env.TEST_MEMGRAPH_URI;
if (!uri) throw new Error('TEST_MEMGRAPH_URI is required (use an isolated test database)');

await initDriver(uri, '', '', 12, 1000);
const db = getDriver().session();
const service = new ScheduleService();
const reconcileFixtureAttendance: ScheduleService['reconcileMissedTutorAttendance'] = (now) => service.reconcileMissedTutorAttendance(now, 'attendance-tutor');
const startMs = Date.now() + 2 * 60 * 60_000;
const startsAt = new Date(startMs).toISOString();

try {
  const existing = await db.run('MATCH (n) RETURN count(n) AS total');
  assert.equal(existing.records[0]?.get('total').toNumber(), 0, 'Use an empty isolated database');
  await db.run('CREATE (:User {id: $id})', { id: 'attendance-tutor' });

  const tomorrowPht = new Date(Date.now() + 32 * 60 * 60_000).toISOString().slice(0, 10);
  const opened = await service.openSlots({
    tutorId: 'attendance-tutor', slots: [{ date: tomorrowPht, time: '18:00' }]
  });
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.status, 'open');
  assert.equal(typeof opened[0]?.slotId, 'string');
  const reopened = await service.openSlots({
    tutorId: 'attendance-tutor', slots: [{ date: tomorrowPht, time: '18:00' }]
  });
  assert.equal(reopened[0]?.slotId, opened[0]?.slotId);
  await service.markTutorAttendance({
    tutorId: 'attendance-tutor', bookingIds: [], slotIds: [opened[0]!.slotId],
    status: 'absent', reason: 'Health', additionalInfo: 'Unable to teach'
  });
  const tomorrowPenalty = await db.run(
    `MATCH (s:TimeSlot {slotId: $slotId})
     MATCH (p:Penalty {slotId: $slotId, penaltyCode: '303'})
     RETURN s.status AS status, p.absenceReason AS reason, p.additionalInfo AS info`,
    { slotId: opened[0]!.slotId }
  );
  assert.equal(tomorrowPenalty.records[0]?.get('status'), 'available');
  assert.equal(tomorrowPenalty.records[0]?.get('reason'), 'Health');
  assert.equal(tomorrowPenalty.records[0]?.get('info'), 'Unable to teach');
  const visibleTomorrow = (await service.getTutorSchedule({
    tutorId: 'attendance-tutor', weekOffset: 0
  })).slots.find(slot => slot.slotId === opened[0]!.slotId);
  assert.equal(visibleTomorrow?.penaltyCode, '303');
  assert.equal(visibleTomorrow?.ta303Count, 1);
  await assert.rejects(
    service.openSlots({ tutorId: 'attendance-tutor', slots: [{ date: tomorrowPht, time: '18:00' }] }),
    /lesson day/
  );

  const farPht = new Date(Date.now() + 80 * 60 * 60_000).toISOString().slice(0, 10);
  const farSlot = (await service.openSlots({
    tutorId: 'attendance-tutor', slots: [{ date: farPht, time: '18:00' }]
  }))[0]!;
  await service.markTutorAttendance({
    tutorId: 'attendance-tutor', bookingIds: [], slotIds: [farSlot.slotId],
    status: 'absent', reason: 'Emergency'
  });
  const farPenalties = await db.run(
    `MATCH (p:Penalty {slotId: $slotId, penaltyCode: '303'}) RETURN count(p) AS total`,
    { slotId: farSlot.slotId }
  );
  assert.equal(farPenalties.records[0]?.get('total').toNumber(), 0);
  assert.equal((await service.openSlots({
    tutorId: 'attendance-tutor', slots: [{ date: farPht, time: '18:00' }]
  }))[0]?.slotId, farSlot.slotId);

  const nowPht = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
  if (nowPht.slice(11, 16) < '22:20') {
    const todayPht = nowPht.slice(0, 10);
    const sameDaySlot = (await service.openSlots({
      tutorId: 'attendance-tutor', slots: [{ date: todayPht, time: '23:30' }]
    }))[0]!;
    const reopenSameDay = () => service.openSlots({
      tutorId: 'attendance-tutor', slots: [{ date: todayPht, time: '23:30' }]
    });
    await service.markTutorAttendance({
      tutorId: 'attendance-tutor', bookingIds: [], slotIds: [sameDaySlot.slotId],
      status: 'absent', reason: 'Internet Outage'
    });
    await assert.rejects(reopenSameDay(), /30 minutes/);
    await db.run(
      `MATCH (p:Penalty {slotId: $slotId, penaltyCode: '303'})
       SET p.createdAt = datetime($earlier)`,
      { slotId: sameDaySlot.slotId, earlier: new Date(Date.now() - 31 * 60_000).toISOString() }
    );
    assert.equal((await reopenSameDay())[0]?.slotId, sameDaySlot.slotId);
    await service.markTutorAttendance({
      tutorId: 'attendance-tutor', bookingIds: [], slotIds: [sameDaySlot.slotId],
      status: 'absent', reason: 'Electric Outage'
    });
    await assert.rejects(reopenSameDay(), /one reopening/);
    const secondPenalty = await db.run(
      `MATCH (p:Penalty {slotId: $slotId, penaltyCode: '303'}) RETURN count(p) AS total`,
      { slotId: sameDaySlot.slotId }
    );
    assert.equal(secondPenalty.records[0]?.get('total').toNumber(), 2);
  }

  const bookings = [
    { id: 'normal-missed', bookedAt: new Date(startMs - 60 * 60_000).toISOString(), status: 'confirmed', attendance: null, enforce: true },
    { id: 'late-missed', bookedAt: new Date(startMs - 7 * 60_000).toISOString(), status: 'confirmed', attendance: null, enforce: true },
    { id: 'already-present', bookedAt: new Date(startMs - 60 * 60_000).toISOString(), status: 'confirmed', attendance: 'present', enforce: true },
    { id: 'cancelled', bookedAt: new Date(startMs - 60 * 60_000).toISOString(), status: 'cancelled', attendance: null, enforce: true },
    { id: 'future-seed', bookedAt: new Date().toISOString(), status: 'confirmed', attendance: null, enforce: null },
  ];
  for (const booking of bookings) {
    await db.run(
      `CREATE (s:TimeSlot {slotId: $id, tutorId: 'attendance-tutor', status: 'booked', slotDate: '2026-10-01', slotTime: '18:00'})
       CREATE (b:Booking {bookingId: $id, tutorId: 'attendance-tutor', status: $status,
                          attendanceTutor: $attendance, attendanceAutoEnforce: $enforce,
                          bookedAt: datetime($bookedAt), slotDateTime: datetime($startsAt)})
       CREATE (b)-[:BOOKS]->(s)`,
      { ...booking, startsAt }
    );
  }

  const nearStartMs = Date.now() + 8 * 60_000;
  await db.run(
    `CREATE (s:TimeSlot {slotId: 'near-seed', tutorId: 'attendance-tutor', status: 'booked',
                          slotDate: '2026-10-01', slotTime: '18:00'})
     CREATE (b:Booking {bookingId: 'near-seed', tutorId: 'attendance-tutor', status: 'confirmed',
                        bookedAt: datetime($bookedAt), slotDateTime: datetime($startsAt)})
     CREATE (b)-[:BOOKS]->(s)`,
    {
      bookedAt: new Date(nearStartMs - 60 * 60_000).toISOString(),
      startsAt: new Date(nearStartMs).toISOString()
    }
  );

  await service.enableAutoAttendanceForUpcomingBookings();
  await db.run("MATCH (b:Booking {bookingId: 'already-present'}) SET b.tutorRoomAttendedAt = b.slotDateTime");
  const seeded = await db.run('MATCH (b:Booking {bookingId: $id}) RETURN b.attendanceAutoEnforce AS enabled', { id: 'future-seed' });
  assert.equal(seeded.records[0]?.get('enabled'), true);
  assert.equal(await reconcileFixtureAttendance(new Date(nearStartMs - 4 * 60_000)), 0);
  assert.equal(await reconcileFixtureAttendance(new Date(nearStartMs - 2 * 60_000)), 0);

  const manualStartMs = Date.now() + 20 * 60_000;
  if (new Date(manualStartMs + 8 * 60 * 60_000).toISOString().slice(11, 16) <= '23:00') {
  for (const [id, offset] of [['manual-first', 0], ['manual-next', 30 * 60_000], ['manual-third', 0]] as const) {
    const slotMs = manualStartMs + offset;
    const pht = new Date(slotMs + 8 * 60 * 60_000).toISOString();
    await db.run(
      `CREATE (s:TimeSlot {slotId: $id, tutorId: 'attendance-tutor', status: 'booked',
                            slotDate: $date, slotTime: $time})
       CREATE (b:Booking {bookingId: $id, tutorId: 'attendance-tutor', status: 'confirmed',
                          bookedAt: datetime($bookedAt), slotDateTime: datetime($startsAt)})
       CREATE (b)-[:BOOKS]->(s)`,
      {
        id, date: pht.slice(0, 10), time: pht.slice(11, 16),
        bookedAt: new Date(slotMs - 60 * 60_000).toISOString(), startsAt: new Date(slotMs).toISOString()
      }
    );
  }
  await service.markTutorAttendance({
    tutorId: 'attendance-tutor', bookingIds: ['manual-next', 'manual-first'], slotIds: [], status: 'absent', reason: 'Emergency'
  });
  const manualPenalties = await db.run(
    `MATCH (p:Penalty {penaltyCode: '301'}) WHERE p.bookingId IN ['manual-first', 'manual-next']
     RETURN count(p) AS total`
  );
  assert.equal(manualPenalties.records[0]?.get('total').toNumber(), 2);
  await service.markTutorAttendance({
    tutorId: 'attendance-tutor', bookingIds: ['manual-third'], slotIds: [], status: 'absent', reason: 'Emergency'
  });
  const manualBlock = await db.run("MATCH (p:Penalty {penaltyCode: '601'}) RETURN count(p) AS total");
  assert.equal(manualBlock.records[0]?.get('total').toNumber(), 1);
  await service.markTutorAttendance({
    tutorId: 'attendance-tutor', bookingIds: ['manual-first', 'manual-next'], slotIds: [], status: 'present'
  });
  await service.markTutorAttendance({
    tutorId: 'attendance-tutor', bookingIds: ['manual-third'], slotIds: [], status: 'present'
  });
  const clearedBlock = await db.run("MATCH (p:Penalty {penaltyCode: '601'}) RETURN count(p) AS total");
  assert.equal(clearedBlock.records[0]?.get('total').toNumber(), 0);
  const corrected = await db.run(
    `MATCH (b:Booking) WHERE b.bookingId IN ['manual-first', 'manual-next', 'manual-third']
     OPTIONAL MATCH (p:Penalty {bookingId: b.bookingId, penaltyCode: '301'})
     RETURN b.bookingId AS id, b.attendanceTutor AS attendance,
            b.penaltyCode AS code, count(p) AS penalties`
  );
  assert.equal(corrected.records.length, 3);
  corrected.records.forEach(record => {
    assert.equal(record.get('attendance'), 'present');
    assert.equal(record.get('code'), null);
    assert.equal(record.get('penalties').toNumber(), 0);
  });
  await db.run("MATCH (b:Booking) WHERE b.bookingId IN ['manual-first', 'manual-next', 'manual-third'] SET b.tutorRoomAttendedAt = b.slotDateTime");
  }

  const lateStartMs = Date.now() + 8 * 60_000;
  const latePht = new Date(lateStartMs + 8 * 60 * 60_000).toISOString();
  await db.run(
    `CREATE (s:TimeSlot {slotId: 'late-manual', tutorId: 'attendance-tutor', status: 'booked',
                         slotDate: $date, slotTime: $time})
     CREATE (b:Booking {bookingId: 'late-manual', tutorId: 'attendance-tutor', status: 'confirmed',
                        bookedAt: datetime($bookedAt), slotDateTime: datetime($startsAt)})
     CREATE (b)-[:BOOKS]->(s)`,
    {
      date: latePht.slice(0, 10), time: latePht.slice(11, 16),
      bookedAt: new Date().toISOString(), startsAt: new Date(lateStartMs).toISOString()
    }
  );
  await assert.rejects(service.markTutorAttendance({
    tutorId: 'attendance-tutor', bookingIds: ['late-manual'], slotIds: [],
    status: 'absent', reason: 'Emergency'
  }), /35 to 11 minutes/);
  const lateMarked = await db.run(
    "MATCH (b:Booking {bookingId: 'late-manual'}) RETURN b.attendanceTutor AS attendance, b.penaltyCode AS code"
  );
  assert.equal(lateMarked.records[0]!.get('attendance'), null);
  assert.equal(lateMarked.records[0]!.get('code'), null);

  const openStartMs = Date.now() + 23 * 60_000;
  if (new Date(openStartMs + 8 * 60 * 60_000).toISOString().slice(11, 16) <= '23:00') {
  for (const [id, offset] of [['open-anchor', 0], ['open-follow', 30 * 60_000]] as const) {
    const pht = new Date(openStartMs + offset + 8 * 60 * 60_000).toISOString();
    await db.run(
      `CREATE (s:TimeSlot {slotId: $id, tutorId: 'attendance-tutor', status: 'open',
                            slotDate: $date, slotTime: $time})`,
      { id, date: pht.slice(0, 10), time: pht.slice(11, 16) }
    );
  }
  await service.markTutorAttendance({
    tutorId: 'attendance-tutor', bookingIds: [], slotIds: ['open-anchor'], status: 'present'
  });
  await service.markTutorAttendance({
    tutorId: 'attendance-tutor', bookingIds: [], slotIds: ['open-follow'], status: 'present'
  });
  const openAttendance = await db.run(
    `MATCH (s:TimeSlot) WHERE s.slotId IN ['open-anchor', 'open-follow']
     RETURN s.slotId AS id, s.attendanceMarked AS attendance`
  );
  assert.equal(openAttendance.records.length, 2);
  openAttendance.records.forEach(record => assert.equal(record.get('attendance'), 'present'));
  await service.markTutorAttendance({
    tutorId: 'attendance-tutor', bookingIds: [], slotIds: ['open-follow'], status: 'absent', reason: 'Emergency'
  });
  const correctedOpen = await db.run(
    `MATCH (s:TimeSlot {slotId: 'open-follow'})
     MATCH (p:Penalty {slotId: 'open-follow', penaltyCode: '303'})
     RETURN s.status AS status, s.attendanceMarked AS attendance, p.absenceReason AS reason`
  );
  assert.equal(correctedOpen.records[0]?.get('status'), 'available');
  assert.equal(correctedOpen.records[0]?.get('attendance'), null);
  assert.equal(correctedOpen.records[0]?.get('reason'), 'Emergency');
  }

  assert.equal(await reconcileFixtureAttendance(new Date(startMs - 11 * 60_000)), 0);
  assert.equal(await reconcileFixtureAttendance(new Date(startMs - 11 * 60_000 + 1)), 0);
  assert.equal(await reconcileFixtureAttendance(new Date(startMs - 10 * 60_000)), 0);
  assert.equal(await reconcileFixtureAttendance(new Date(startMs - 3 * 60_000)), 0);
  assert.equal(await reconcileFixtureAttendance(new Date(startMs - 2 * 60_000)), 0);
  assert.equal(await reconcileFixtureAttendance(new Date(startMs - 2 * 60_000 + 1)), 0);
  assert.equal(await reconcileFixtureAttendance(new Date(startMs)), 0);
  assert.equal(await reconcileFixtureAttendance(new Date(startMs + 25 * 60_000)), 3);
  assert.equal(await reconcileFixtureAttendance(new Date(startMs + 26 * 60_000)), 0);

  const result = await db.run(
    `MATCH (b:Booking) WHERE b.bookingId IN ['normal-missed', 'late-missed', 'already-present', 'cancelled', 'future-seed', 'near-seed']
     OPTIONAL MATCH (p:Penalty {bookingId: b.bookingId, penaltyCode: '301'})
     RETURN b.bookingId AS id, b.attendanceTutor AS attendance, b.penaltyCode AS code, count(p) AS penalties`
  );
  const rows = new Map(result.records.map(record => [record.get('id'), {
    attendance: record.get('attendance'), code: record.get('code'), penalties: record.get('penalties').toNumber()
  }]));
  for (const id of ['normal-missed', 'late-missed', 'future-seed']) {
    assert.deepEqual(rows.get(id), { attendance: 'absent', code: '301', penalties: 1 });
  }
  assert.deepEqual(rows.get('near-seed'), { attendance: null, code: null, penalties: 0 });
  assert.deepEqual(rows.get('already-present'), { attendance: 'present', code: null, penalties: 0 });
  assert.deepEqual(rows.get('cancelled'), { attendance: null, code: null, penalties: 0 });
  const blocks = await db.run("MATCH (p:Penalty {penaltyCode: '601'}) RETURN count(p) AS total");
  assert.equal(blocks.records[0]?.get('total').toNumber(), 1);
  console.log('PASS: automatic attendance deadlines, late bookings, penalty persistence, and idempotence');
} finally {
  await db.close();
  await closeDriver();
}
