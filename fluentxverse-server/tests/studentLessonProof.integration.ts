import { strict as assert } from 'node:assert';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import Proof from '../src/routes/proof.route';
import { signAuthToken } from '../src/utils/jwt';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';

const uri = process.env.TEST_MEMGRAPH_URI;
if (!uri) throw new Error('TEST_MEMGRAPH_URI is required (use an isolated test database)');

process.env.ZKVERIFY_ENABLED = 'false';
process.env.STUDENT_LESSON_ISSUER_SECRET = 'integration-test-issuer-not-for-production';
process.env.JWT_SECRET = 'integration-test-jwt-secret-only-not-for-production';

await initDriver(uri, '', '', 12, 1000);
const db = getDriver().session();
const timestamp = new Date(Date.now() - 60 * 60_000).toISOString();
const cases = [
  { id: 'proof-present', student: 'proof-student', status: 'confirmed', attendance: 'present' },
  { id: 'proof-absent', student: 'proof-student', status: 'confirmed', attendance: 'absent' },
  { id: 'proof-cancelled', student: 'proof-student', status: 'cancelled', attendance: 'present' },
  { id: 'proof-other-student', student: 'other-student', status: 'confirmed', attendance: 'present' },
];

try {
  const existing = await db.run('MATCH (n) RETURN count(n) AS total');
  assert.equal(existing.records[0]!.get('total').toNumber(), 0, 'Integration test requires an empty isolated database');
  for (const row of cases) {
    await db.run(`MERGE (s:Student {id: $student})
      CREATE (slot:TimeSlot {slotId: $id, slotDate: '2020-01-01', slotTime: '10:00 AM', durationMinutes: 25})
      CREATE (b:Booking {bookingId: $id, tutorId: 'proof-tutor', status: $status,
        attendanceStudent: $attendance, durationMinutes: 25, slotDateTime: datetime($timestamp)})
      CREATE (b)-[:BOOKED_BY]->(s) CREATE (b)-[:BOOKS]->(slot)`, { ...row, timestamp });
  }

  const token = await signAuthToken({ userId: 'proof-student', email: 'student@example.test' });
  const call = (path: string, authenticated = true, method = 'GET') =>
    Proof.handle(new Request(`http://localhost${path}`, {
      method, headers: authenticated ? { Cookie: `studentAuth=${token}` } : {},
    }));

  const unauthenticated = await call('/proof/student-lessons/me', false);
  assert.equal(unauthenticated.status, 401);
  const list = await call('/proof/student-lessons/me');
  assert.equal(list.status, 200);
  const data = (await list.json() as any).data;
  assert.equal(data.find((p: any) => p.bookingId === 'proof-present').eligible, true);
  assert.equal(data.find((p: any) => p.bookingId === 'proof-absent').eligible, false);
  assert.equal(data.find((p: any) => p.bookingId === 'proof-cancelled').eligible, false);
  assert.equal(data.some((p: any) => p.bookingId === 'proof-other-student'), false);

  for (const id of ['proof-absent', 'proof-cancelled', 'proof-other-student']) {
    const response = await call(`/proof/student-lessons/${id}/claim`, true, 'POST');
    assert.equal(response.status, 400, `${id}: ${await response.text()}`);
  }
  const claim = await call('/proof/student-lessons/proof-present/claim', true, 'POST');
  assert.equal(claim.status, 200, await claim.clone().text());
  const proof = (await claim.json() as any).data;
  assert.equal(proof.status, 'local_proof_generated');
  assert.match(proof.commitment, /^\d+$/);

  const publicLookup = await call(`/proof/student-lessons/public/${proof.commitment}`, false);
  assert.equal(publicLookup.status, 200);
  const published = (await publicLookup.json() as any).data;
  assert.equal(published.localProofVerified, true);
  assert.equal(published.status, 'local_proof_generated');
  assert.equal(JSON.stringify(published).includes('proof-student'), false);
  assert.equal(JSON.stringify(published).includes('proof-present'), false);
  const schedule = new ScheduleService();
  await assert.rejects(() => schedule.markAttendance({ bookingId: 'proof-present', tutorId: 'wrong-tutor', role: 'tutor', status: 'present' }),
    /Booking not found for tutor/);
  await schedule.markAttendance({ bookingId: 'proof-present', tutorId: 'proof-tutor', role: 'tutor', status: 'present' });
  const attendance = await db.run('MATCH (b:Booking {bookingId: $bookingId}) RETURN b.attendanceStudent AS attendance',
    { bookingId: 'proof-present' });
  assert.equal(attendance.records[0]!.get('attendance'), 'present');
  console.log('PASS: auth, booking and tutor ownership, eligibility, local Groth16 claim, public status and privacy');
} finally {
  await db.close();
  await closeDriver();
}
