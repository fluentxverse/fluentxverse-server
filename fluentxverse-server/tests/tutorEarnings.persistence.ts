import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { tutorCompensationService as rates } from '../src/services/admin.services/tutorCompensation.service';
import { tutorEarningsService as earnings } from '../src/services/admin.services/tutorEarnings.service';

if (process.env.EARNINGS_TEST_URI !== 'bolt://127.0.0.1:17699') throw Error('Use only an empty disposable earnings graph on port 17699.');
await initDriver(process.env.EARNINGS_TEST_URI, '', '', 1);
const db = getDriver().session();
try {
  assert.equal((await db.run('MATCH (n) RETURN count(n) AS total')).records[0]!.get('total').toNumber(), 0);
  await db.run(`CREATE (:User {id:'tutor-a'}), (:User {id:'tutor-b'}),
    (:Admin {id:'finance',role:'admin',permissions:['finance']}), (:Admin {id:'finance-2',role:'admin',permissions:['finance']}),
    (:Admin {id:'support',role:'admin',permissions:['support']})`);
  const rate = async (version: number, amount: string, at: string) => {
    const r = await rates.save('tutor-a', { currency: 'USD', amount, expectedVersion: version, requestId: crypto.randomUUID(), reason: 'Synthetic rate' }, 'finance');
    await db.run('MATCH (r:TutorRateChange {id:$id}) SET r.changedAt=$at', { id: r.change.id, at });
  };
  await rate(0, '12.34', '2026-01-01T00:00:00.000Z');
  await rate(1, '15.00', '2026-03-01T00:00:00.000Z');
  const lesson = async (id: string, at: string, patch: Record<string, any> = {}) => db.run(`CREATE (b:Booking)
    SET b=$booking`, { booking: { bookingId: id, tutorId: 'tutor-a', status: 'completed', lessonOutcome: 'attended',
      attendanceTutor: 'present', attendanceStudent: 'present', finalizedAt: at, slotDateTime: new Date(Date.parse(at) - 25 * 60000).toISOString(), durationMinutes: 25, ...patch } });
  await lesson('lesson-old', '2026-02-01T00:00:00.000Z'); await lesson('lesson-new', '2026-04-01T00:00:00.000Z');
  await lesson('lesson-race', '2026-04-01T00:00:00.000Z'); await lesson('lesson-missing-rate', '2025-01-01T00:00:00.000Z');
  await lesson('lesson-refunded', '2026-04-01T00:00:00.000Z', { refunded: true });
  await assert.rejects(earnings.post('tutor-a', 'lesson-old', 'support', 'Approve'), /Finance/);
  await assert.rejects(earnings.post('tutor-b', 'lesson-old', 'finance', 'Approve'), /base rate/);
  await assert.rejects(earnings.post('tutor-a', 'lesson-missing-rate', 'finance', 'Approve'), /No approved rate/);
  await assert.rejects(earnings.post('tutor-a', 'lesson-refunded', 'finance', 'Approve'), /not finalized/);
  const old = await earnings.post('tutor-a', 'lesson-old', 'finance', 'Approve');
  assert.equal(old.earning.netCents, 1234); assert.equal(old.earning.rateVersion, 1);
  assert.equal((await earnings.post('tutor-a', 'lesson-new', 'finance', 'Approve')).earning.netCents, 1500);
  await rate(2, '20.00', '2026-05-01T00:00:00.000Z');
  assert.equal((await earnings.post('tutor-a', 'lesson-old', 'finance', 'Retry')).earning.netCents, 1234);
  const posted = await Promise.allSettled(['finance', 'finance-2'].map(a => earnings.post('tutor-a', 'lesson-race', a, 'Concurrent approval')));
  assert(posted.some(r => r.status === 'fulfilled'));
  assert.equal((await db.run("MATCH (e:TutorEarning {bookingId:'lesson-race'}) RETURN count(e) AS n")).records[0]!.get('n').toNumber(), 1);
  const request = (ids: string[]) => ({ requestId: crypto.randomUUID(), bookingIds: ids, recipient: `0x${'1'.repeat(40)}`, reason: 'Synthetic payout approval' });
  const input = request(['lesson-old', 'lesson-new']);
  const reserved = await earnings.reserve('tutor-a', input, 'finance');
  assert.equal(reserved.batch.totalCents, 2734); assert.equal(reserved.batch.transferEnabled, false); assert.equal(reserved.batch.zkVerified, false);
  assert.equal((await earnings.reserve('tutor-a', input, 'finance')).replayed, true);
  await assert.rejects(earnings.reserve('tutor-a', { ...input, recipient: `0x${'2'.repeat(40)}` }, 'finance'), /already used/);
  await assert.rejects(earnings.reserve('tutor-a', input, 'finance-2'), /already used/);
  await assert.rejects(earnings.reserve('tutor-a', request(['lesson-new']), 'finance'), /already reserved/);
  const evidence = await earnings.evidence('tutor-a', reserved.batch.id, 'finance');
  assert.equal(evidence.earnings.length, 2); assert.equal(evidence.zkVerified, false); assert.equal(evidence.transferEnabled, false);
  if (process.env.EARNINGS_PROOF_FIXTURE) {
    if (process.env.EARNINGS_PROOF_FIXTURE !== '/tmp/fxv-payout-evidence-20261014.json') throw Error('Only the synthetic QA fixture path is allowed.');
    await writeFile(process.env.EARNINGS_PROOF_FIXTURE, JSON.stringify({ synthetic: true, ...evidence }), { mode: 0o600 });
  }
  await assert.rejects(earnings.evidence('tutor-a', reserved.batch.id, 'support'), /Finance/);
  const race = await Promise.allSettled(['finance', 'finance-2'].map(a => earnings.reserve('tutor-a', request(['lesson-race']), a)));
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await db.run("MATCH (p:TutorPayoutBatch)-[:RESERVES_EARNING]->(:TutorEarning {bookingId:'lesson-race'}) RETURN count(p) AS n")).records[0]!.get('n').toNumber(), 1);
  await db.run("MATCH (b:Booking {bookingId:'lesson-old'}) SET b.refundApprovedBy='finance'");
  await assert.rejects(earnings.evidence('tutor-a', reserved.batch.id, 'finance'), /not finalized/);
  await db.run("MATCH (b:Booking {bookingId:'lesson-old'}) REMOVE b.refundApprovedBy SET b.compensationHold=true");
  await assert.rejects(earnings.evidence('tutor-a', reserved.batch.id, 'finance'), /not finalized/);
  await db.run("MATCH (b:Booking {bookingId:'lesson-old'}) REMOVE b.compensationHold");
  await db.run('MATCH (p:TutorPayoutBatch {id:$id}) SET p.expiresAt=$at', { id: reserved.batch.id, at: '2026-01-01T00:00:00.000Z' });
  await assert.rejects(earnings.evidence('tutor-a', reserved.batch.id, 'finance'), /expired/);
  await db.run("MATCH (a:Admin {id:'finance'}) SET a.permissions=['support']");
  await assert.rejects(earnings.list('tutor-a', 'finance'), /Finance/);
  assert.equal((await db.run("MATCH (t:User {id:'tutor-a'}) RETURN t")).records[0]!.get('t').properties.netCents, undefined);
  console.log('PASS: historical USD rate versions, exactly-once earnings, overlapping payout races, retries, refund/hold/expiry gates and revoked finance permissions. No payments sent.');
} finally { await db.close(); await closeDriver(); }
