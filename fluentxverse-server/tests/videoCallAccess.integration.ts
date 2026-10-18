import { strict as assert } from 'node:assert';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';
import { canJoinInterview } from '../src/socket/handlers/interview.handler';

const uri = process.env.TEST_MEMGRAPH_URI;
if (!uri) throw new Error('TEST_MEMGRAPH_URI is required (use an isolated test database)');

await initDriver(uri, process.env.MEMGRAPH_USER || '', process.env.MEMGRAPH_PASSWORD || '', 2, 500);
const session = getDriver().session();
const service = new ScheduleService();
let isolated = false;
try {
  const count = await session.run('MATCH (n) RETURN count(n) AS total');
  assert.equal(count.records[0]?.get('total').toNumber(), 0, 'Use an empty isolated database');
  isolated = true;
  await session.run(`
    CREATE (:Student {id: 'student-a'})
    CREATE (:Student {id: 'student-b'})
    CREATE (slot:TimeSlot {slotId: 'call-slot', status: 'booked'})
    CREATE (booking:Booking {bookingId: 'call-booking', studentId: 'student-a',
                             tutorId: 'tutor-a', status: 'confirmed'})-[:BOOKS]->(slot)
    CREATE (:InterviewSlot {id: 'interview-slot', tutorId: 'tutor-a', status: 'booked'})
  `);

  assert.equal(await service.canStudentJoinRoom('call-booking', 'student-a'), true);
  assert.equal(await service.canStudentJoinRoom('call-booking', 'student-b'), false);
  assert.equal(await service.canStudentJoinRoom('unknown-booking', 'student-a'), false);
  await session.run("MATCH (b:Booking {bookingId: 'call-booking'}) SET b.status = 'cancelled'");
  assert.equal(await service.canStudentJoinRoom('call-booking', 'student-a'), false);
  assert.equal(await canJoinInterview('interview-interview-slot', 'tutor', 'tutor-a'), true);
  assert.equal(await canJoinInterview('interview-interview-slot', 'tutor', 'tutor-b'), false);
  assert.equal(await canJoinInterview('interview-interview-slot', 'admin', 'admin-a'), true);
  assert.equal(await canJoinInterview('interview-default', 'admin', 'admin-a'), false);
  await session.run("MATCH (slot:InterviewSlot {id: 'interview-slot'}) SET slot.status = 'cancelled'");
  assert.equal(await canJoinInterview('interview-interview-slot', 'admin', 'admin-a'), false);
} finally {
  if (isolated) await session.run('MATCH (n) DETACH DELETE n');
  await session.close();
  await closeDriver();
}
