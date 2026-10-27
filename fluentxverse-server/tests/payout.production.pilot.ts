import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { tutorCompensationService as rates } from '../src/services/admin.services/tutorCompensation.service';
import { tutorEarningsService as earnings } from '../src/services/admin.services/tutorEarnings.service';
import { tutorPayoutAuthorizationService as authorization } from '../src/services/admin.services/tutorPayoutAuthorization.service';

if (process.env.RUN_LIVE_PAYOUT_PILOT !== 'one-authorized-mainnet-submission' || process.env.PAYOUT_PILOT_GRAPH !== 'bolt://127.0.0.1:17699')
  throw Error('Only the isolated payout pilot graph is allowed');
const file = process.env.PAYOUT_PILOT_JOURNAL!;
let journal: any = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { synthetic: true, stage: 'new', startedAt: new Date().toISOString() };
const save = () => writeFileSync(file, JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
const request = async (path: string) => {
  const r = await fetch(process.env.GMR_PAYOUT_ENGINE_API_BASE + path, { headers: { 'X-GMR-Engine-Key': process.env.GMR_PAYOUT_ENGINE_API_KEY! }, signal: AbortSignal.timeout(95000), redirect: 'error' });
  if (!r.ok) throw Error('Pilot Engine request failed: ' + r.status);
  return r.json();
};
await initDriver(process.env.PAYOUT_PILOT_GRAPH, '', '', 1);
const db = getDriver().session();
try {
  const readiness = await authorization.readiness();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.chainId, 8453);
  assert.equal(readiness.verificationNetwork, 'zkVerify');
  assert.equal(readiness.releasePolicy, 'self-operated');
  assert.equal(readiness.submissionsEnabled, true);
  if (journal.stage === 'new') {
    assert.equal((await db.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n').toNumber(), 0);
    const account: any = await request('/v1/zkverify/account');
    assert.equal(account.network, 'zkVerify');
    assert(BigInt(account.account.freeBalance) > 1000000000000000000n, 'Insufficient native VFY fee reserve');
    journal.account = account.account.address;
    journal.balanceBefore = account.account.freeBalance;
    save();
    await db.run(`CREATE (:User {id:'payout-pilot-tutor'}),(:Student {id:'payout-pilot-student'}),
      (:Admin {id:'payout-pilot-finance',role:'admin',permissions:['finance']}),(:Admin {id:'payout-pilot-support',role:'admin',permissions:['support']})`);
    const rate = await rates.save('payout-pilot-tutor', { currency: 'USD', amount: '1.23', expectedVersion: 0, requestId: crypto.randomUUID(), reason: 'Synthetic proof pilot; never payable' }, 'payout-pilot-finance');
    await db.run('MATCH (h:TutorRateChange {id:$id}) SET h.changedAt=$at', { id: rate.change.id, at: new Date(Date.now() - 86400000).toISOString() });
    await db.run(`MATCH(s:Student {id:'payout-pilot-student'}) CREATE (:Booking {bookingId:'payout-pilot-lesson',tutorId:'payout-pilot-tutor',status:'completed',lessonOutcome:'attended',attendanceTutor:'present',attendanceStudent:'present',finalizedAt:$at,slotDateTime:datetime($start),durationMinutes:25})-[:BOOKED_BY]->(s)`, { at: new Date(Date.now() - 60000).toISOString(), start: new Date(Date.now() - 1800000).toISOString() });
    await earnings.post('payout-pilot-tutor', 'payout-pilot-lesson', 'payout-pilot-finance', 'Synthetic proof pilot');
    const reservation = await earnings.reserve('payout-pilot-tutor', { requestId: crypto.randomUUID(), bookingIds: ['payout-pilot-lesson'], recipient: '0x0000000000000000000000000000000000001234', reason: 'Synthetic proof pilot; no transfer' }, 'payout-pilot-finance');
    journal.batchId = reservation.batch.id;
    journal.stage = 'reserved'; save();
  }
  const args = ['payout-pilot-tutor', journal.batchId, 'payout-pilot-finance', {}] as const;
  if (journal.stage === 'reserved') {
    await assert.rejects(authorization.generate(args[0], args[1], 'payout-pilot-support', {}), /Finance/);
    const result = await authorization.generate(...args);
    assert.equal(result.authorization?.phase, 'locally_proved');
    assert.equal(result.transferEnabled, false);
    const raw = (await db.run('MATCH(a:TutorPayoutAuthorization {batchId:$id}) RETURN a', { id: journal.batchId })).records[0]!.get('a').properties;
    const config = JSON.parse(readFileSync(process.env.PAYOUT_PILOT_OPERATOR_CONFIG!, 'utf8'));
    journal.productionKeyQA = JSON.parse(execFileSync('node', [resolve('../..', 'budol/gmr-engine/scripts/payout-production-proof-qa.mjs')], {
      input: JSON.stringify({ vk: JSON.parse(readFileSync(config.vkPath, 'utf8')), proof: JSON.parse(raw.proofJson), signals: JSON.parse(raw.signalsJson) }), encoding: 'utf8', timeout: 120000,
    }));
    journal.stage = 'proved'; save();
    console.log('PASS production Engine generated and locally verified the synthetic payout proof');
  }
  if (journal.stage === 'proved') {
    // Persist intent before the only paid call. Restart must never send it again.
    journal.stage = 'submission-intent'; save();
    const result = await authorization.submit(...args);
    journal.engineSubmissionId = result.authorization?.engineSubmissionId;
    assert(journal.engineSubmissionId);
    journal.stage = 'submitted'; save();
    console.log(JSON.stringify({ event: 'payout-proof-submitted', engineSubmissionId: journal.engineSubmissionId }));
  }
  if (journal.stage === 'submission-intent') throw Error('Uncertain submission: inspect Engine and journal; do not resend');
  if (journal.stage === 'submitted') {
    const result = await authorization.reconcile(...args);
    const proof: any = await request('/v1/zkverify/proofs/' + journal.engineSubmissionId);
    const receipt: any = await request('/v1/zkverify/proofs/' + journal.engineSubmissionId + '/receipt');
    journal.nativeStatus = proof.submission.status;
    journal.nativeResult = JSON.parse(proof.submission.transactionResult || '{}');
    journal.receipt = receipt.receipt;
    journal.phase = result.authorization?.phase;
    journal.lastCheckedAt = new Date().toISOString();
    save();
    if (result.authorization?.phase === 'receipt_verified') {
      const before: any = await request('/v1/zkverify/proofs/' + journal.engineSubmissionId);
      await assert.rejects(authorization.submit(...args), /Do not resend|unavailable or expired/);
      const after: any = await request('/v1/zkverify/proofs/' + journal.engineSubmissionId);
      assert.equal(after.submission.id, before.submission.id);
      assert.equal(after.submission.status, 'finalized');
      const wasExpired = !(await authorization.detail(...args.slice(0, 3) as [string, string, string])).currentlyEligible;
      await db.run("MATCH (b:Booking {bookingId:'payout-pilot-lesson'}) SET b.refunded=true");
      const refunded = await authorization.reconcile(...args);
      assert.equal(refunded.currentlyEligible, false);
      assert.equal(refunded.authorization?.phase, 'receipt_verified');
      await db.run(`MATCH(s:Student {id:'payout-pilot-student'}) CREATE (:Booking {bookingId:'payout-pilot-refund',tutorId:'payout-pilot-tutor',status:'completed',lessonOutcome:'attended',attendanceTutor:'present',attendanceStudent:'present',finalizedAt:$at,slotDateTime:datetime($start),durationMinutes:25})-[:BOOKED_BY]->(s)`, { at: new Date(Date.now() - 60000).toISOString(), start: new Date(Date.now() - 1800000).toISOString() });
      await earnings.post('payout-pilot-tutor', 'payout-pilot-refund', 'payout-pilot-finance', 'Independent refund rejection check');
      const fresh = await earnings.reserve('payout-pilot-tutor', { requestId: crypto.randomUUID(), bookingIds: ['payout-pilot-refund'], recipient: '0x0000000000000000000000000000000000001234', reason: 'Synthetic refund rejection; no submission' }, 'payout-pilot-finance');
      assert.equal((await authorization.detail('payout-pilot-tutor', fresh.batch.id, 'payout-pilot-finance')).currentlyEligible, true);
      await db.run("MATCH(b:Booking {bookingId:'payout-pilot-refund'}) SET b.refunded=true");
      assert.equal((await authorization.detail('payout-pilot-tutor', fresh.batch.id, 'payout-pilot-finance')).currentlyEligible, false);
      await assert.rejects(authorization.generate('payout-pilot-tutor', fresh.batch.id, 'payout-pilot-finance', {}), /payable|refunded|unavailable/i);
      assert.equal((await db.run("MATCH(e:TutorEarning {status:'paid'}) RETURN count(e) AS n")).records[0]!.get('n').toNumber(), 0);
      journal.stage = 'complete';
      journal.checks = { financeAuthorization: true, productionProofLocallyVerified: true, productionPublicSignalsRejected: journal.productionKeyQA.publicSignalsRejected, productionTamperedProofRejected: journal.productionKeyQA.tamperedProofRejected, nativeFinalized: true, officialBaseReceiptVerified: true, duplicateSubmissionRejected: true, expiredEntitlementRejected: wasExpired, refundedEntitlementRejected: true, noEarningsMarkedPaid: true };
      journal.transfersEnabled = false;
      save();
    }
  }
  console.log(JSON.stringify({ synthetic: true, stage: journal.stage, phase: journal.phase, engineSubmissionId: journal.engineSubmissionId, receiptStatus: journal.receipt?.status, transfersEnabled: false }));
} finally { await db.close(); await closeDriver(); }
