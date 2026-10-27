import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Elysia from 'elysia';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { tutorCompensationService as rates } from '../src/services/admin.services/tutorCompensation.service';
import { tutorEarningsService as earnings } from '../src/services/admin.services/tutorEarnings.service';
import { TutorPayoutRecoveryService, type PayoutEnginePort, type PayoutIntent, type PayoutObservation } from '../src/services/admin.services/tutorPayoutRecovery.service';

if (process.env.PAYOUT_RECOVERY_TEST_URI !== 'bolt://127.0.0.1:17699') throw Error('Use only the empty disposable payout recovery graph on port 17699.');
process.env.JWT_SECRET = 'synthetic-payout-recovery-fixture-not-for-production';
await initDriver(process.env.PAYOUT_RECOVERY_TEST_URI, '', '', 1);
const db = getDriver().session();
const recovery = new TutorPayoutRecoveryService();
const recipient = `0x${'1'.repeat(40)}`;
const policy = { chainId: 2651420 as const, verificationNetwork: 'Volta' as const,
  releaseManifestSHA256: 'a'.repeat(64), settlementPolicySHA256: 'b'.repeat(64) };
const outcome = (intent: PayoutIntent, hash: string, status: PayoutObservation['status']): PayoutObservation => ({
  submissionKey: intent.submissionKey, intentHash: hash, status, engineTransactionId: `engine-${intent.batchId}`,
  ...(status === 'settled' || status === 'reverted' ? { transactionHash: `0x${createHash('sha256').update(intent.submissionKey).digest('hex')}`,
    chainId: policy.chainId, settlementEvidenceHash: `0x${'d'.repeat(64)}` } : {}),
});
class FixtureEngine implements PayoutEnginePort {
  submissions = 0;
  lookups = 0;
  accepted = new Map<string, { intent: PayoutIntent; hash: string }>();
  failBeforeAcceptance = false;
  failAfterAcceptance = false;
  lookupFails = false;
  status: PayoutObservation['status'] = 'pending';
  async approvedPolicy() { return policy; }
  async submit(intent: PayoutIntent, hash: string) {
    this.submissions++;
    if (this.failBeforeAcceptance) throw Error('Synthetic transport interruption before acceptance');
    assert(!this.accepted.has(intent.submissionKey), 'Application must never resubmit a dispatch claim.');
    this.accepted.set(intent.submissionKey, { intent, hash });
    if (this.failAfterAcceptance) throw Error('Synthetic response loss after acceptance');
    return outcome(intent, hash, this.status);
  }
  async lookup(intent: PayoutIntent, hash: string) {
    this.lookups++;
    if (this.lookupFails) throw Error('SENSITIVE_SYNTHETIC_ENGINE_ERROR_NOT_FOR_LOGS');
    const found = this.accepted.get(intent.submissionKey);
    if (!found) return { submissionKey: intent.submissionKey, intentHash: hash, status: 'unknown' as const };
    assert.equal(found.hash, hash);
    return outcome(intent, hash, this.status);
  }
}
const count = async (query: string, params = {}) => (await db.run(query, params)).records[0]!.get('n').toNumber();
const cancelInput = () => ({ requestId: crypto.randomUUID(), reason: 'Synthetic finance cancellation' });
let serial = 0;
async function batch(size = 1) {
  const ids: string[] = [];
  for (let i = 0; i < size; i++) {
    const id = `payout-lesson-${++serial}`; ids.push(id);
    await db.run(`CREATE (:Booking {bookingId:$id,tutorId:'tutor-a',status:'completed',lessonOutcome:'attended',attendanceTutor:'present',
      attendanceStudent:'present',finalizedAt:'2026-02-01T00:00:00.000Z',slotDateTime:'2026-01-31T23:35:00.000Z',durationMinutes:25})`, { id });
    await earnings.post('tutor-a', id, 'finance', 'Synthetic finalized lesson');
  }
  const result = await earnings.reserve('tutor-a', { requestId: crypto.randomUUID(), bookingIds: ids, recipient, reason: 'Synthetic payout reservation' }, 'finance');
  return { id: result.batch.id as string, ids };
}
async function interruptAfterPreparation(id: string, engine: FixtureEngine) {
  const worker = new TutorPayoutRecoveryService(engine);
  const original = (worker as any).transaction.bind(worker);
  let calls = 0;
  (worker as any).transaction = (...args: unknown[]) => {
    if (++calls === 3) throw Error('Synthetic crash after preparation, before dispatch claim');
    return original(...args);
  };
  await assert.rejects(worker.process('tutor-a', id, 'finance'), /Synthetic crash after preparation/);
}
try {
  assert.equal(await count('MATCH (n) RETURN count(n) AS n'), 0, 'Disposable database must start empty.');
  await db.run(`CREATE (:User {id:'tutor-a'}),(:User {id:'tutor-b'}),
    (:Admin {id:'finance',role:'admin',permissions:['finance']}),(:Admin {id:'finance-2',role:'admin',permissions:['finance']}),
    (:Admin {id:'support',role:'admin',permissions:['support']})`);
  const saved = await rates.save('tutor-a', { currency: 'USD', amount: '12.34', expectedVersion: 0, requestId: crypto.randomUUID(), reason: 'Fixture rate' }, 'finance');
  await db.run('MATCH (h:TutorRateChange {id:$id}) SET h.changedAt=$at', { id: saved.change.id, at: '2026-01-01T00:00:00.000Z' });

  const first = await batch(2), input = cancelInput();
  await assert.rejects(recovery.process('tutor-a', first.id, 'finance'), /Transfers remain disabled/);
  assert.equal(await count('MATCH (o:TutorPayoutOperation) RETURN count(o) AS n'), 0);
  assert.equal((await recovery.detail('tutor-a', first.id, 'finance')).canCancel, true);
  await assert.rejects(recovery.cancel('tutor-a', first.id, 'support', input), /Finance/);
  await assert.rejects(recovery.detail('tutor-b', first.id, 'finance'), /base rate/);
  const cancelled = await recovery.cancel('tutor-a', first.id, 'finance', input);
  assert.equal(cancelled.replayed, false);
  assert.equal((await recovery.cancel('tutor-a', first.id, 'finance', input)).replayed, true);
  await assert.rejects(recovery.cancel('tutor-a', first.id, 'finance', { ...input, reason: 'Different request' }), /already used/);
  await assert.rejects(recovery.cancel('tutor-a', first.id, 'finance-2', input), /already used/);
  assert.equal(await count("MATCH (e:TutorPayoutEvent {batchId:$id,action:'cancelled'}) RETURN count(e) AS n", { id: first.id }), 1);
  assert.equal(await count("MATCH (e:TutorEarning) WHERE e.bookingId IN $ids AND e.status='unclaimed' AND e.payoutBatchId IS NULL RETURN count(e) AS n", { ids: first.ids }), 2);
  await assert.rejects(earnings.evidence('tutor-a', first.id, 'finance'), /unavailable/);
  const replacement = await earnings.reserve('tutor-a', { requestId: crypto.randomUUID(), bookingIds: first.ids, recipient, reason: 'New reservation after safe cancellation' }, 'finance');
  assert(replacement.batch.id !== first.id);

  const rollback = await batch(2);
  await db.run('MATCH (e:TutorEarning {bookingId:$id}) SET e.payoutBatchId=$other', { id: rollback.ids[1], other: 'inconsistent-owner' });
  await assert.rejects(recovery.cancel('tutor-a', rollback.id, 'finance', cancelInput()), /ownership/);
  assert.equal(await count("MATCH (e:TutorEarning {bookingId:$id,status:'reserved',payoutBatchId:$batch}) RETURN count(e) AS n", { id: rollback.ids[0], batch: rollback.id }), 1, 'Failed cancellation must roll back earlier releases.');

  const refunded = await batch();
  await db.run('MATCH (b:Booking {bookingId:$id}) SET b.refunded=true', { id: refunded.ids[0] });
  await recovery.cancel('tutor-a', refunded.id, 'finance', cancelInput());
  assert.equal(await count("MATCH (e:TutorEarning {bookingId:$id,status:'held'}) RETURN count(e) AS n", { id: refunded.ids[0] }), 1);
  await assert.rejects(earnings.reserve('tutor-a', { requestId: crypto.randomUUID(), bookingIds: refunded.ids, recipient, reason: 'Must not re-pay refunded lesson' }, 'finance'), /not finalized/);

  const expired = await batch();
  await db.run('MATCH (p:TutorPayoutBatch {id:$id}) SET p.expiresAt=$at', { id: expired.id, at: '2020-01-01T00:00:00.000Z' });
  assert.equal((await recovery.detail('tutor-a', expired.id, 'finance')).batch.status, 'reserved');
  await recovery.cancel('tutor-a', expired.id, 'finance', cancelInput());
  const historical = await batch();
  await db.run('MATCH (p:TutorPayoutBatch {id:$id}) REMOVE p.recoveryVersion', { id: historical.id });
  await assert.rejects(recovery.cancel('tutor-a', historical.id, 'finance', cancelInput()), /Submission may have occurred/);

  const prepared = await batch(), preparedEngine = new FixtureEngine();
  await interruptAfterPreparation(prepared.id, preparedEngine);
  assert.equal((await recovery.detail('tutor-a', prepared.id, 'finance')).operation!.phase, 'prepared');
  assert.equal(preparedEngine.submissions, 0);
  await db.run('MATCH (b:Booking {bookingId:$id}) SET b.refundApprovedBy=$actor', { id: prepared.ids[0], actor: 'finance' });
  await assert.rejects(new TutorPayoutRecoveryService(preparedEngine).process('tutor-a', prepared.id, 'finance'), /not finalized/);
  assert.equal(preparedEngine.submissions, 0, 'A refund before dispatch must block the Engine call.');
  await recovery.cancel('tutor-a', prepared.id, 'finance', cancelInput());
  assert.equal((await recovery.detail('tutor-a', prepared.id, 'finance')).operation!.phase, 'cancelled');
  assert.equal(await count("MATCH (e:TutorEarning {bookingId:$id,status:'held'}) RETURN count(e) AS n", { id: prepared.ids[0] }), 1);

  const inconsistent = await batch(), inconsistentEngine = new FixtureEngine();
  await interruptAfterPreparation(inconsistent.id, inconsistentEngine);
  await db.run('MATCH (o:TutorPayoutOperation {batchId:$id}) SET o.dispatchCount=1,o.dispatchStartedAt=$at', { id: inconsistent.id, at: new Date().toISOString() });
  await assert.rejects(new TutorPayoutRecoveryService(inconsistentEngine).process('tutor-a', inconsistent.id, 'finance'), /Existing dispatch evidence/);
  await assert.rejects(recovery.cancel('tutor-a', inconsistent.id, 'finance', cancelInput()), /Submission may have occurred/);
  assert.equal(inconsistentEngine.submissions, 0);
  assert.equal((await recovery.detail('tutor-a', inconsistent.id, 'finance')).needsFinancialReview, true);

  const altered = await batch();
  await db.run('MATCH (p:TutorPayoutBatch {id:$id}) SET p.totalCents=1235', { id: altered.id });
  await assert.rejects(earnings.evidence('tutor-a', altered.id, 'finance'), /total changed/);

  const before = await batch(), beforeEngine = new FixtureEngine(); beforeEngine.failBeforeAcceptance = true;
  const beforeWorker = new TutorPayoutRecoveryService(beforeEngine);
  assert.equal((await beforeWorker.process('tutor-a', before.id, 'finance')).operation!.phase, 'review');
  await new TutorPayoutRecoveryService(beforeEngine).process('tutor-a', before.id, 'finance');
  assert.equal(beforeEngine.submissions, 1, 'Even apparent pre-acceptance failure must not be resubmitted.');
  await assert.rejects(recovery.cancel('tutor-a', before.id, 'finance', cancelInput()), /Submission may have occurred/);

  const lost = await batch(2), lostEngine = new FixtureEngine(); lostEngine.failAfterAcceptance = true;
  await new TutorPayoutRecoveryService(lostEngine).process('tutor-a', lost.id, 'finance');
  lostEngine.status = 'settled';
  const recovered = await new TutorPayoutRecoveryService(lostEngine).reconcile('tutor-a', lost.id, 'finance');
  assert.equal(recovered.batch.status, 'paid'); assert.equal(recovered.operation!.phase, 'settled');
  assert.equal(recovered.batch.adjustmentRequired, false); assert.equal(recovered.transferEnabled, false);
  await new TutorPayoutRecoveryService(lostEngine).process('tutor-a', lost.id, 'finance');
  assert.equal(lostEngine.submissions, 1);
  assert.equal(await count("MATCH (e:TutorEarning {paidOperationId:$id,status:'paid'}) RETURN count(e) AS n", { id: recovered.operation!.id }), 2);
  assert.equal(await count("MATCH (e:TutorPayoutEvent {batchId:$id,action:'settled'}) RETURN count(e) AS n", { id: lost.id }), 1);

  const crash = await batch(), crashEngine = new FixtureEngine();
  const crashing = new TutorPayoutRecoveryService(crashEngine);
  // Simulate death after Engine accepts, before the response is journaled. This
  // test-only monkeypatch does not add a fault-injection switch to production.
  (crashing as any).apply = async () => { throw Error('Synthetic process death before database commit'); };
  await assert.rejects(crashing.process('tutor-a', crash.id, 'finance'), /Synthetic process death/);
  assert.equal((await recovery.detail('tutor-a', crash.id, 'finance')).operation!.phase, 'dispatching');
  await db.run('MATCH (b:Booking {bookingId:$id}) SET b.refundApprovedBy=$actor', { id: crash.ids[0], actor: 'finance' });
  await db.run('MATCH (p:TutorPayoutBatch {id:$id}) SET p.expiresAt=$at', { id: crash.id, at: '2020-01-01T00:00:00.000Z' });
  crashEngine.status = 'settled';
  const afterCrash = await new TutorPayoutRecoveryService(crashEngine).reconcile('tutor-a', crash.id, 'finance');
  assert.equal(afterCrash.batch.status, 'paid'); assert.equal(afterCrash.batch.adjustmentRequired, true);
  assert.equal(crashEngine.submissions, 1, 'Expired reservation or refund after dispatch cannot trigger another payment.');

  const racing = await batch(), raceEngine = new FixtureEngine();
  const raced = await Promise.allSettled(['finance', 'finance-2'].map(actor => new TutorPayoutRecoveryService(raceEngine).process('tutor-a', racing.id, actor)));
  assert(raced.some(r => r.status === 'fulfilled'));
  assert.equal(raceEngine.submissions, 1);
  assert.equal(await count('MATCH (o:TutorPayoutOperation {batchId:$id}) RETURN count(o) AS n', { id: racing.id }), 1);
  raceEngine.lookupFails = true;
  const unavailable = await new TutorPayoutRecoveryService(raceEngine).reconcile('tutor-a', racing.id, 'finance');
  assert.equal(unavailable.operation!.phase, 'review');
  assert(!JSON.stringify(unavailable).includes('SENSITIVE_SYNTHETIC_ENGINE_ERROR'));
  assert.equal(raceEngine.submissions, 1);
  raceEngine.lookupFails = false; raceEngine.status = 'reverted';
  assert.equal((await new TutorPayoutRecoveryService(raceEngine).reconcile('tutor-a', racing.id, 'finance')).operation!.phase, 'reverted');
  await assert.rejects(recovery.cancel('tutor-a', racing.id, 'finance', cancelInput()), /Submission may have occurred/);
  assert.equal(await count("MATCH (e:TutorEarning {bookingId:$id,status:'reserved'}) RETURN count(e) AS n", { id: racing.ids[0] }), 1);

  const late = await batch(), lateEngine = new FixtureEngine();
  let accepted!: () => void, release!: () => void;
  const acceptedPromise = new Promise<void>(resolve => { accepted = resolve; });
  const releasePromise = new Promise<void>(resolve => { release = resolve; });
  const originalSubmit = lateEngine.submit.bind(lateEngine);
  lateEngine.submit = async (intent, hash) => {
    const pending = await originalSubmit(intent, hash);
    accepted();
    await releasePromise;
    return pending;
  };
  const delayed = new TutorPayoutRecoveryService(lateEngine).process('tutor-a', late.id, 'finance');
  await Promise.race([acceptedPromise, delayed.then(() => { throw Error('Dispatch returned before the fixture accepted its intent'); })]);
  lateEngine.status = 'settled';
  try {
    assert.equal((await new TutorPayoutRecoveryService(lateEngine).reconcile('tutor-a', late.id, 'finance-2')).batch.status, 'paid');
  } finally { release(); }
  assert.equal((await delayed).operation!.phase, 'settled', 'Late pending response must not regress settled accounting.');
  assert.equal(lateEngine.submissions, 1);
  assert.equal(await count("MATCH (e:TutorPayoutEvent {batchId:$id,action:'settled'}) RETURN count(e) AS n", { id: late.id }), 1);

  const duplicateReceipt = await batch(), duplicateEngine = new FixtureEngine();
  const duplicateSubmit = duplicateEngine.submit.bind(duplicateEngine);
  duplicateEngine.status = 'settled';
  duplicateEngine.submit = async (intent, hash) => ({ ...await duplicateSubmit(intent, hash), transactionHash: afterCrash.operation!.transactionHash });
  await assert.rejects(new TutorPayoutRecoveryService(duplicateEngine).process('tutor-a', duplicateReceipt.id, 'finance'), /concurrently|constraint/i);
  assert.equal(await count("MATCH (e:TutorEarning {bookingId:$id,status:'reserved'}) RETURN count(e) AS n", { id: duplicateReceipt.ids[0] }), 1, 'Reused payment receipt must roll back paid accounting.');
  assert.equal((await recovery.detail('tutor-a', duplicateReceipt.id, 'finance')).batch.status, 'processing');

  for (let iteration = 0; iteration < 3; iteration++) {
    const contested = await batch(), contestedEngine = new FixtureEngine();
    await Promise.allSettled([
      new TutorPayoutRecoveryService(contestedEngine).process('tutor-a', contested.id, 'finance'),
      recovery.cancel('tutor-a', contested.id, 'finance-2', cancelInput()),
    ]);
    const result = await recovery.detail('tutor-a', contested.id, 'finance');
    if (result.batch.status === 'cancelled') assert.equal(contestedEngine.submissions, 0);
    else {
      assert.equal(result.batch.status, 'processing');
      assert.equal(contestedEngine.submissions, 1);
      assert.equal(result.canCancel, false);
    }
  }

  const { tutorEarningsRoute } = await import('../src/routes/tutorEarnings.route');
  const { signAuthToken } = await import('../src/utils/jwt');
  const app = new Elysia().use(tutorEarningsRoute);
  const call = async (actor: string | null, path: string, method = 'GET', body?: unknown, origin = 'https://dashboard.fluentxverse.com', role = 'admin') => {
    const headers: Record<string, string> = { origin, 'Content-Type': 'application/json' };
    if (actor) headers.cookie = `adminAuth=${await signAuthToken({ userId: actor, email: 'fixture@example.test', role })}`;
    return app.handle(new Request(`http://localhost/admin/operations/compensation/tutor-a/payouts${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
  };
  for (const [actor, role] of [[null, 'admin'], ['support', 'admin'], ['finance', 'student'], ['finance', 'tutor']] as const) {
    assert.equal((await call(actor, '', 'GET', undefined, undefined, role)).status, 403);
    assert.equal((await call(actor, `/${lost.id}/reconcile`, 'POST', {}, undefined, role)).status, 403);
  }
  for (const origin of ['https://evil.example', 'https://student.fluentxverse.com', '']) {
    assert.equal((await call('finance', '', 'GET', undefined, origin)).status, 403);
    assert.equal((await call('finance', `/${lost.id}/cancel`, 'POST', cancelInput(), origin)).status, 403);
  }
  const listed = await call('finance', '');
  assert.equal(listed.status, 200); assert.equal(listed.headers.get('cache-control'), 'private, no-store');
  assert.equal((await call('finance', `/${lost.id}`)).status, 200);
  assert.equal((await call('finance', `/${lost.id}/reconcile`, 'POST', { status: 'settled', transactionHash: `0x${'f'.repeat(64)}` })).status, 400);
  assert.equal((await call('finance', `/${lost.id}/submit`, 'POST', {})).status, 404);
  assert.equal((await call('finance', `/${first.id}/cancel`, 'POST', input)).status, 200);
  assert.equal((await call('finance', `/${first.id}/cancel`, 'POST', { ...input, status: 'paid' })).status, 400);
  await db.run("MATCH (a:Admin {id:'finance'}) SET a.permissions=['support']");
  assert.equal((await call('finance', '')).status, 403);
  await assert.rejects(recovery.list('tutor-a', 'finance'), /Finance/);
  console.log('PASS: real Memgraph cancellation rollback, held refunds, immutable intents, single dispatch, response loss, restart reconciliation, late responses, dispatch/cancel races, receipt reuse denial, expired/refunded post-dispatch accounting, finance/origin guards and disabled live transfers. Engine outcomes were simulated; no network submissions or funds.');
} finally { await db.close(); await closeDriver(); }
