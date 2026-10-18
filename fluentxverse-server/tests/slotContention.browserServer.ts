import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
assert.equal(process.env.MEMGRAPH_URI, 'bolt://fxv-slot-qa-memgraph:7687');
assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'fxv-slot-qa-postgres');
assert.equal(process.env.ALLOW_MOCK_TICKET_PURCHASES, 'true');
assert.equal(process.env.GMR_ENGINE_API_KEY, undefined);
const { initDriver, getDriver } = await import('../src/db/memgraph');
const { signAuthToken } = await import('../src/utils/jwt');
const { default: Schedule } = await import('../src/routes/schedule.route');
const { default: Ticket } = await import('../src/routes/ticket.route');
const { default: Elysia } = await import('elysia');
await initDriver(process.env.MEMGRAPH_URI!, '', '', 20, 500);
const graph = getDriver().session();
const date = new Date(Date.now() + 24 * 3600_000 + 8 * 3600_000).toISOString().slice(0, 10);
const run = Date.now();
const fixture = { image: process.env.SLOT_QA_IMAGE, slotId: `browser-slot-qa-${run}`, tutorId: `browser-tutor-qa-${run}`, date, time: '20:00', students: [] as any[] };
const number = (value: any) => typeof value?.toNumber === 'function' ? value.toNumber() : Number(value);
try {
  assert.equal(number((await graph.run('MATCH (s:TimeSlot {slotId:$slotId}) RETURN count(s) AS count', { slotId: fixture.slotId })).records[0]!.get('count')), 0);
  await graph.run(`CREATE (t:User {id:$id,email:'browser-tutor@example.invalid',firstName:'QA',lastName:'Tutor',
    writtenExamPassed:true,speakingExamPassed:true,profileStatus:'approved'})
    CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId:$slotId,tutorId:$id,slotDate:$date,slotTime:$time,status:'open',durationMinutes:25})`,
    { id: fixture.tutorId, slotId: fixture.slotId, date, time: fixture.time });
  for (let i = 0; i < 2; i++) {
    const id = `browser-student-qa-${run}-${i}`, wallet = `0x${(50000 + run + i).toString(16).padStart(40, '0')}`;
    await graph.run(`CREATE (:Student {id:$id,firstName:$name,externalWalletAddress:$wallet})
      CREATE (:MockTicketBalance {walletAddress:$wallet,basic:2,premium:0,trial:0})`, { id, name: `QA Student ${i}`, wallet });
    fixture.students.push({ id, wallet, token: await signAuthToken({ userId: id, email: `${id}@example.invalid`, role: 'student' }, 1800) });
  }
} finally { await graph.close(); }
writeFileSync('/qa-report/browser-fixture.json', JSON.stringify(fixture), { mode: 0o600 });
new Elysia().use(Schedule).use(Ticket)
  .get('/qa/summary', async () => {
    const session = getDriver().session();
    try {
      const bookings = await session.run('MATCH (b:Booking {slotId:$slotId}) RETURN b', { slotId: fixture.slotId });
      const payments = await session.run('MATCH (p:TicketTransaction {slotId:$slotId}) RETURN p', { slotId: fixture.slotId });
      const students = [];
      for (const student of fixture.students) {
        const [balance, transfers] = [
          await session.run('MATCH (b:MockTicketBalance {walletAddress:$wallet}) RETURN b.basic AS basic', { wallet: student.wallet }),
          await session.run('MATCH (t:MockTicketTransfer {studentId:$id}) RETURN count(t) AS total', { id: student.id }),
        ];
        students.push({ id: student.id, balance: number(balance.records[0]!.get('basic')), transfers: number(transfers.records[0]!.get('total')) });
      }
      return { bookings: bookings.records.map(row => ({ bookingId: row.get('b').properties.bookingId, studentId: row.get('b').properties.studentId })),
        deductions: payments.records.length, students };
    } finally { await session.close(); }
  }).listen({ hostname: '0.0.0.0', port: 8765 });
console.log('Isolated browser contention server ready.');
