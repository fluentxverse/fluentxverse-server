import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Run the production image with only disposable databases on an internal Docker network.
assert.equal(process.env.MEMGRAPH_URI, 'bolt://fxv-slot-qa-memgraph:7687');
assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'fxv-slot-qa-postgres');
assert.equal(process.env.ALLOW_MOCK_TICKET_PURCHASES, 'true');
assert.equal(process.env.LESSON_BOOKING_MODE, 'paid');
assert.equal(process.env.LESSON_PASSES_ENABLED, 'false');
assert.equal(process.env.GMR_ENGINE_API_KEY, undefined);
assert.equal(process.env.PRIVY_APP_SECRET, undefined);

const { initDriver, getDriver, closeDriver } = await import('../src/db/memgraph');
const { db: logs } = await import('../src/db/postgres');
const { initRedis, closeRedis } = await import('../src/db/redis');
const { signAuthToken } = await import('../src/utils/jwt');
const { default: Schedule } = await import('../src/routes/schedule.route');
const { default: Ticket } = await import('../src/routes/ticket.route');
const { default: Elysia } = await import('elysia');

await initDriver(process.env.MEMGRAPH_URI!, '', '', 20, 500);
await initRedis();
const graph = getDriver().session();
const app = new Elysia().use(Schedule).use(Ticket).listen({ hostname: '127.0.0.1', port: 0 });
const base = `http://127.0.0.1:${app.server!.port}`;
const results: any[] = [];
const wallets = (round: number, student: number) => `0x${(1000 + round * 2 + student).toString(16).padStart(40, '0')}`;
const value = (v: any) => v?.toNumber ? v.toNumber() : v;
const request = async (token: string, path: string, body: any) => {
  const response = await fetch(base + path, { method: 'POST', headers: {
    cookie: `studentAuth=${token}`, 'content-type': 'application/json', origin: 'https://student.fluentxverse.com',
  }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any };
};

try {
  assert.equal(value((await graph.run('MATCH (n) RETURN count(n) AS count')).records[0]!.get('count')), 0, 'Must be a fresh disposable database');
  await graph.run(`CREATE (:User {id:'slot-qa-tutor', email:'synthetic-tutor@example.invalid',
    firstName:'Synthetic', lastName:'Tutor', writtenExamPassed:true, speakingExamPassed:true, profileStatus:'approved'})`);
  for (let round = 0; round < 20; round++) {
    const slotId = `slot-qa-${round}`;
    const future = new Date(Date.now() + (180 + round * 60) * 60_000 + 8 * 3600_000).toISOString();
    const students = [`slot-qa-student-${round}-a`, `slot-qa-student-${round}-b`];
    const tokens = await Promise.all(students.map(userId => signAuthToken({ userId, email: `${userId}@example.invalid`, role: 'student' }, 600)));
    await graph.run(`MATCH (t:User {id:'slot-qa-tutor'}) CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {
      slotId:$slotId,tutorId:'slot-qa-tutor',slotDate:$date,slotTime:$time,status:'open',durationMinutes:25})`,
      { slotId, date: future.slice(0, 10), time: future.slice(11, 16) });
    for (let i = 0; i < 2; i++) await graph.run(`CREATE (:Student {id:$id,firstName:$id,externalWalletAddress:$wallet})
      CREATE (:MockTicketBalance {walletAddress:$wallet,basic:2,premium:0,trial:0})`, { id: students[i], wallet: wallets(round, i) });

    // Both authenticated HTTP requests start before either response is awaited.
    const contenders = await Promise.all(tokens.map(token => request(token, '/schedule/reserve', { slotId })));
    assert.equal(contenders.filter(r => r.status === 200 && r.body.success).length, 1);
    assert.equal(contenders.filter(r => r.status === 400 && !r.body.success).length, 1);
    const winner = contenders.findIndex(r => r.body.success), loser = 1 - winner;
    assert.match(contenders[loser]!.body.error, /available|reserved/i);
    const hold = contenders[winner]!.body.data;
    const repeatedHold = await request(tokens[winner]!, '/schedule/reserve', { slotId });
    assert.equal(repeatedHold.body.data.reservationId, hold.reservationId);
    let row = (await graph.run('MATCH (s:TimeSlot {slotId:$slotId}) RETURN s', { slotId })).records[0]!.get('s').properties;
    assert.equal(row.pendingBy, students[winner]); assert.equal(row.status, 'pending');

    // The losing account cannot steal/release the winner's reservation or create a phantom booking.
    const forged = await request(tokens[loser]!, '/schedule/book', { slotId, reservationId: hold.reservationId, ticketTransferTxHash: 'mock-ticket-forged' });
    assert.equal(forged.status, 400); assert.equal(forged.body.success, false);
    await request(tokens[loser]!, '/schedule/release-reservation', { slotId, reservationId: hold.reservationId });
    row = (await graph.run('MATCH (s:TimeSlot {slotId:$slotId}) RETURN s', { slotId })).records[0]!.get('s').properties;
    assert.equal(row.pendingBy, students[winner]); assert.equal(row.reservationId, hold.reservationId);

    // Match the client checkout order: reserve first; only its winner spends a ticket.
    const payment = await request(tokens[winner]!, '/tickets/consume', { walletAddress: wallets(round, winner), tier: 'basic', quantity: 1 });
    assert.equal(payment.status, 200); assert.equal(payment.body.success, true);
    const bookingInput = { slotId, reservationId: hold.reservationId, ticketTransferTxHash: payment.body.data.transactionHash };
    const booking = await request(tokens[winner]!, '/schedule/book', bookingInput);
    assert.equal(booking.status, 200); assert.equal(booking.body.success, true);
    assert.equal(booking.body.data.studentId, students[winner]);
    assert.equal((await request(tokens[winner]!, '/schedule/book', bookingInput)).body.data.bookingId, booking.body.data.bookingId);
    const loseAgain = await request(tokens[loser]!, '/schedule/reserve', { slotId });
    assert.equal(loseAgain.status, 400);

    const bookings = await graph.run('MATCH (b:Booking {slotId:$slotId}) RETURN b', { slotId });
    assert.equal(bookings.records.length, 1);
    assert.equal(bookings.records[0]!.get('b').properties.studentId, students[winner]);
    const payments = await graph.run('MATCH (p:TicketTransaction {slotId:$slotId}) RETURN p', { slotId });
    assert.equal(payments.records.length, 1);
    assert.equal(payments.records[0]!.get('p').properties.studentId, students[winner]);
    const balances: number[] = [];
    for (const i of [0, 1]) balances.push(value((await graph.run(
      'MATCH (b:MockTicketBalance {walletAddress:$wallet}) RETURN b.basic AS balance', { wallet: wallets(round, i) })).records[0]!.get('balance')));
    assert.equal(balances[winner], 1); assert.equal(balances[loser], 2);
    assert.equal(value((await graph.run('MATCH (t:MockTicketTransfer {studentId:$studentId}) RETURN count(t) AS count',
      { studentId: students[loser] })).records[0]!.get('count')), 0);
    assert.equal(value((await graph.run('MATCH (b:Booking {studentId:$studentId}) RETURN count(b) AS count',
      { studentId: students[loser] })).records[0]!.get('count')), 0);
    row = (await graph.run('MATCH (s:TimeSlot {slotId:$slotId}) RETURN s', { slotId })).records[0]!.get('s').properties;
    assert.equal(row.status, 'booked'); assert.equal(row.studentId, students[winner]);
    assert.equal(row.reservationId, undefined); assert.equal(row.pendingBy, undefined);
    results.push({ round: round + 1, reserveStatuses: contenders.map(r => r.status), bookings: 1,
      deductions: 1, winnerBalance: balances[winner], loserBalance: balances[loser], forgedBookingRejected: true, retryIdempotent: true });
  }
  const hashes = Object.fromEntries(['src/services/schedule.services/schedule.service.ts', 'src/routes/schedule.route.ts',
    'src/services/ticket.services/ticket.service.ts', 'src/routes/ticket.route.ts'].map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
  const report = { testedAt: new Date().toISOString(), image: process.env.SLOT_QA_IMAGE, synthetic: true,
    scope: 'Actual server image, authenticated HTTP routes and real disposable Memgraph, mock ticket settlement; no external chain payment or production customer data',
    rounds: results.length, students: results.length * 2, passed: true, hashes, results };
  if (process.env.SLOT_QA_REPORT) {
    assert.equal(process.env.SLOT_QA_REPORT, '/qa-report/slot-contention.json');
    writeFileSync(process.env.SLOT_QA_REPORT, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  console.log(JSON.stringify({ passed: true, rounds: results.length, students: results.length * 2, bookings: results.length,
    chargedLosers: 0, phantomBookings: 0, duplicateBookings: 0, duplicateDeductions: 0, image: report.image, hashes }));
} finally {
  await app.stop(); await graph.close(); await closeDriver(); await logs.close(); await closeRedis();
}
