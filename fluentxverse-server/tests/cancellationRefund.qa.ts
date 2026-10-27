import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
assert.equal(process.env.MEMGRAPH_URI, 'bolt://fxv-slot-qa-memgraph:7687');
assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'fxv-slot-qa-postgres');
assert.equal(process.env.ALLOW_MOCK_TICKET_PURCHASES, 'true');
assert.equal(process.env.LESSON_BOOKING_MODE, 'paid');
assert.equal(process.env.GMR_ENGINE_API_KEY, undefined);
const { initDriver, getDriver, closeDriver } = await import('../src/db/memgraph');
const { db: logs } = await import('../src/db/postgres');
const { initRedis, closeRedis } = await import('../src/db/redis');
const { signAuthToken } = await import('../src/utils/jwt');
const { default: Schedule } = await import('../src/routes/schedule.route');
const { default: Ticket } = await import('../src/routes/ticket.route');
const { default: Elysia } = await import('elysia');
const { cancellationRefundService } = await import('../src/services/ticket.services/cancellationRefund.service');
const { tutorCompensationService: rates } = await import('../src/services/admin.services/tutorCompensation.service');
const { tutorEarningsService: earnings } = await import('../src/services/admin.services/tutorEarnings.service');
await initDriver(process.env.MEMGRAPH_URI!, '', '', 20, 1000);
await initRedis();
const graph = getDriver().session(), number = (v: any) => v?.toNumber?.() ?? Number(v);
const app = new Elysia().use(Schedule).use(Ticket).listen({ hostname: '127.0.0.1', port: 0 });
const base = `http://127.0.0.1:${app.server!.port}`;
async function api(token: string, path: string, body?: any) {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: {
    cookie: `studentAuth=${token}`, 'content-type': 'application/json', origin: 'https://student.fluentxverse.com',
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() as any };
}
async function booking(id: string) { return (await graph.run('MATCH (b:Booking {bookingId:$id}) RETURN b', { id })).records[0]!.get('b').properties; }
async function balance(wallet: string) { return number((await graph.run('MATCH (b:MockTicketBalance {walletAddress:$wallet}) RETURN b.basic AS n', { wallet })).records[0]!.get('n')); }
async function fixture(name: string, offset: number) {
  const id = `refund-qa-${name}`, wallet = `0x${(900 + offset).toString(16).padStart(40, '0')}`, slotId = id;
  const start = new Date(Date.now() + offset * 60000);
  const pht = new Date(start.getTime() + 8 * 3600000).toISOString();
  await graph.run(`CREATE (:Student {id:$id,firstName:$id,externalWalletAddress:$wallet}) CREATE (:MockTicketBalance {walletAddress:$wallet,basic:2,premium:0,trial:0})
    WITH 1 AS unused MATCH (t:User {id:'refund-qa-tutor'}) CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId:$slotId,tutorId:t.id,slotDate:$date,slotTime:$time,status:'open',durationMinutes:25})`,
    { id, wallet, slotId, date: pht.slice(0, 10), time: pht.slice(11, 16) });
  const token = await signAuthToken({ userId: id, role: 'student', email: `${id}@example.invalid` }, 1800);
  const held = await api(token, '/schedule/reserve', { slotId }); assert.equal(held.status, 200);
  const payment = await api(token, '/tickets/consume', { walletAddress: wallet, tier: 'basic', quantity: 1 }); assert.equal(payment.status, 200);
  const booked = await api(token, '/schedule/book', { slotId, reservationId: held.body.data.reservationId, ticketTransferTxHash: payment.body.data.transactionHash });
  assert.equal(booked.status, 200); assert.equal(await balance(wallet), 1);
  return { id, wallet, token, slotId, bookingId: booked.body.data.bookingId };
}
const report: any = { testedAt: new Date().toISOString(), image: process.env.SLOT_QA_IMAGE, synthetic: true, cases: [] };
try {
  assert.equal(number((await graph.run('MATCH (n) RETURN count(n) AS n')).records[0]!.get('n')), 0);
  await graph.run(`CREATE (:User {id:'refund-qa-tutor',firstName:'QA',lastName:'Tutor',writtenExamPassed:true,speakingExamPassed:true,interviewPassed:true,profileStatus:'approved'}),
    (:Admin {id:'refund-qa-finance',role:'admin',permissions:['finance']})`);
  const rate = await rates.save('refund-qa-tutor', { currency: 'USD', amount: '12.50', expectedVersion: 0, requestId: crypto.randomUUID(), reason: 'Synthetic QA' }, 'refund-qa-finance');
  await graph.run('MATCH (r:TutorRateChange {id:$id}) SET r.changedAt=$at', { id: rate.change.id, at: new Date(Date.now() - 86400000).toISOString() });
  const early = await fixture('eligible', 240);
  assert.equal((await api(early.token, `/tickets/balance/${early.wallet}`)).body.data.basic, 1);
  const cancellations = await Promise.all(Array.from({ length: 5 }, () => api(early.token, '/schedule/cancel', { bookingId: early.bookingId, reason: 'Synthetic early cancellation' })));
  assert.equal(cancellations.filter(r => r.status === 200 && r.body.success).length, 1);
  assert.equal(cancellations.find(r => r.status === 200)!.body.refunded, true);
  const cancelled = await booking(early.bookingId);
  const earlyResult = { name: 'eligible-concurrent-cancellation', successfulCancellations: 1, status: cancelled.status, refunded: cancelled.refunded,
    refundStatus: cancelled.refundStatus, balance: await balance(early.wallet) };
  report.cases.push(earlyResult);
  writeFileSync('/qa-report/cancellation-refund.json', JSON.stringify(report, null, 2), { mode: 0o600 });
  assert.equal(cancelled.refunded, true, 'An eligible mock-ticket cancellation must actually restore its ticket');
  assert.equal(earlyResult.balance, 2);
  assert.equal((await api(early.token, `/tickets/balance/${early.wallet}`)).body.data.basic, 2, 'Cached displayed credits must refresh after refund');
  assert.equal((await api(early.token, '/schedule/cancel', { bookingId: early.bookingId })).status, 400);
  await Promise.all(Array.from({ length: 5 }, () => cancellationRefundService.process(early.bookingId)));
  await cancellationRefundService.reconcile([early.bookingId]);
  assert.equal(await balance(early.wallet), 2);
  const refunds = await graph.run("MATCH (r:TicketTransaction {bookingId:$id,type:'cancellation'}) RETURN r", { id: early.bookingId });
  assert.equal(refunds.records.length, 1); assert.equal(refunds.records[0]!.get('r').properties.status, 'completed');
  const slot = (await graph.run('MATCH (s:TimeSlot {slotId:$id}) RETURN s', { id: early.slotId })).records[0]!.get('s').properties;
  assert.equal(slot.status, 'open'); assert.equal(slot.studentId, undefined);
  assert.equal((await api(early.token, '/schedule/student-bookings')).body.data.length, 0);
  await assert.rejects(earnings.post('refund-qa-tutor', early.bookingId, 'refund-qa-finance', 'Must reject cancelled lesson'), /not finalized|payable/);

  const late = await fixture('late', 45);
  const lateResult = await api(late.token, '/schedule/cancel', { bookingId: late.bookingId });
  assert.equal(lateResult.status, 200); assert.equal(lateResult.body.refunded, false);
  assert.equal(await balance(late.wallet), 1);
  await cancellationRefundService.process(late.bookingId); assert.equal(await balance(late.wallet), 1);
  await assert.rejects(earnings.post('refund-qa-tutor', late.bookingId, 'refund-qa-finance', 'Must reject cancelled lesson'), /not finalized|payable/);
  report.cases.push({ name: 'late-under-one-hour', cancelled: true, refunded: false, balance: 1, compensationRejected: true });

  const inconsistent = await fixture('inconsistent', 420);
  await graph.run('MATCH (t:MockTicketTransfer {bookingId:$id}) SET t.quantity=2', { id: inconsistent.bookingId });
  const reviewed = await api(inconsistent.token, '/schedule/cancel', { bookingId: inconsistent.bookingId });
  assert.equal(reviewed.status, 200); assert.equal(reviewed.body.refunded, false);
  assert.equal((await booking(inconsistent.bookingId)).refundStatus, 'review');
  await cancellationRefundService.process(inconsistent.bookingId);
  assert.equal(await balance(inconsistent.wallet), 1);
  report.cases.push({ name: 'inconsistent-original-debit', reviewRequired: true, extraCredits: 0 });

  const deadline = await fixture('deadline', 300);
  const startsAt = new Date(Date.now() + 4 * 60000).toISOString();
  await graph.run('MATCH (b:Booking {bookingId:$id}) SET b.slotDateTime=datetime($at)', { id: deadline.bookingId, at: startsAt });
  assert.equal((await api(deadline.token, '/schedule/cancel', { bookingId: deadline.bookingId })).status, 400);
  assert.equal((await booking(deadline.bookingId)).status, 'confirmed'); assert.equal(await balance(deadline.wallet), 1);
  assert.equal((await api(late.token, '/schedule/cancel', { bookingId: deadline.bookingId })).status, 400);
  report.cases.push({ name: 'five-minute-and-ownership-gates', cancellationRejected: true, originalBookingRetained: true, balance: 1 });

  const end = new Date(Date.now() - 60000).toISOString(), start = new Date(Date.now() - 26 * 60000).toISOString();
  for (const [id, refunded, refundStatus] of [['refunded-completion', true, 'completed'], ['pending-refund-completion', false, 'pending'], ['payable-control', false, 'not_required']] as const) {
    await graph.run(`CREATE (:Booking {bookingId:$id,tutorId:'refund-qa-tutor',status:'completed',lessonOutcome:'attended',attendanceTutor:'present',attendanceStudent:'present',
      finalizedAt:$end,slotDateTime:$start,durationMinutes:25,refunded:$refunded,refundStatus:$refundStatus})`, { id, end, start, refunded, refundStatus });
    if (id === 'payable-control') assert.equal((await earnings.post('refund-qa-tutor', id, 'refund-qa-finance', 'Eligible completed control')).earning.netCents, 1250);
    else await assert.rejects(earnings.post('refund-qa-tutor', id, 'refund-qa-finance', 'Must reject refund'), /not finalized|payable/);
  }
  assert.equal(number((await graph.run('MATCH (e:TutorEarning) RETURN count(e) AS n')).records[0]!.get('n')), 1);
  const reservation = await earnings.reserve('refund-qa-tutor', { requestId: crypto.randomUUID(), bookingIds: ['payable-control'],
    recipient: `0x${'1'.repeat(40)}`, reason: 'Synthetic reservation before a later support refund' }, 'refund-qa-finance');
  await graph.run("MATCH (b:Booking {bookingId:'payable-control'}) SET b.refunded=true,b.refundStatus='completed',b.refundApprovedBy='refund-qa-finance'");
  await assert.rejects(earnings.evidence('refund-qa-tutor', reservation.batch.id, 'refund-qa-finance'), /not finalized|payable/);
  await assert.rejects(earnings.reserve('refund-qa-tutor', { requestId: crypto.randomUUID(), bookingIds: ['payable-control'],
    recipient: `0x${'1'.repeat(40)}`, reason: 'Must reject refunded earnings' }, 'refund-qa-finance'), /not finalized|payable/);
  report.cases.push({ name: 'refund-after-earning-reservation', payoutEvidenceRejected: true, newReservationRejected: true, realPaymentsSent: 0 });
  report.cases.push({ name: 'finance-refund-gates', cancelledRejected: true, refundedCompletedRejected: true, pendingRefundRejected: true, payableControlCents: 1250 });
  const timezone = await fixture('timezone', 1440);
  // A midnight rollover in PHT -> JST stresses date handling on devices in other zones.
  const day = new Date(Date.now() + 86400000 + 8 * 3600000).toISOString().slice(0, 10);
  await graph.run(`MATCH (b:Booking {bookingId:$id})-[:BOOKS]->(s:TimeSlot) SET s.slotDate=$day,s.slotTime='23:30',
    b.slotDateTime=datetime($at)`, { id: timezone.bookingId, day, at: `${day}T23:30:00+08:00` });
  const nativeBookings = (await api(timezone.token, '/schedule/student-bookings')).body.data;
  writeFileSync('/qa-report/timezone-fixture.json', JSON.stringify({ synthetic: true, image: process.env.SLOT_QA_IMAGE, studentId: timezone.id,
    wallet: timezone.wallet, bookings: nativeBookings, startsAt: `${day}T23:30:00+08:00`, durationMinutes: 25 }), { mode: 0o600 });
  report.passed = true; report.currency = 'USD'; report.mockTickets = true;
  writeFileSync('/qa-report/cancellation-refund.json', JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
} finally { await app.stop(); await graph.close(); await closeDriver(); await logs.close(); await closeRedis(); }
