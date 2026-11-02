import assert from 'node:assert/strict';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { tutorCompensationService as rates } from '../src/services/admin.services/tutorCompensation.service';
import { tutorEarningsService as earnings } from '../src/services/admin.services/tutorEarnings.service';
import { tutorPayoutAuthorizationService as authorization, validatePayoutAuthorization, validatePayoutProofRelease, payoutAuthorizationEvidence } from '../src/services/admin.services/tutorPayoutAuthorization.service';
import { finalizedDestinationReceipt } from '../src/services/proof.services/horizenReceipt';
import { z } from 'zod';

const proverStatusSchema=z.object({ready:z.boolean(),release:z.object({
  releaseManifestSHA256:z.string(),vkHash:z.string(),policyHash:z.string(),issuerHash:z.string(),issuerAx:z.string(),issuerAy:z.string(),scopeHash:z.string(),
  chainId:z.number().int(),domainId:z.number().int(),bridge:z.string(),verificationNetwork:z.string(),vk:z.record(z.string(),z.unknown()),
  cryptographicSetupVerified:z.boolean(),releasePolicy:z.string(),independentlyReviewed:z.boolean(),independentContributors:z.boolean(),proverBackend:z.string(),
}).passthrough()});
const accountSchema=z.object({network:z.string(),account:z.object({freeBalance:z.string().regex(/^\d+$/)})});
const submissionSchema=z.object({submission:z.object({status:z.string(),transactionResult:z.string().nullish()})});

const graph = 'bolt://fxv-completed-lesson-pilot-20261030:7687';
if (process.env.RUN_COMPLETED_LESSON_PILOT !== 'one-authorized-arbitrum-submission' || process.env.PILOT_GRAPH !== graph)
  throw Error('Only the isolated completed-lesson pilot graph is allowed');
const file = '/pilot/journal.json';
const live = process.env.PILOT_ACTION === 'live';
if (!live && !existsSync(file)) throw Error('No existing pilot to reconcile');
if (live && existsSync(file)) throw Error('Existing pilot journal: reconcile, never resend');
let journal: any = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {
  synthetic: true, kind: 'completed-lesson-payout-authorization', stage: 'new',
  startedAt: new Date().toISOString(), chainId: 42161, domainId: 10, transfersEnabled: false,
};
const save = () => {
  writeFileSync(file + '.tmp', JSON.stringify(journal, null, 2) + '\n', { mode: 0o600 });
  renameSync(file + '.tmp', file);
};
const request = async <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
  const response = await fetch(process.env.GMR_PAYOUT_ENGINE_API_BASE + path, {
    headers: { 'X-GMR-Engine-Key': process.env.GMR_PAYOUT_ENGINE_API_KEY! },
    signal: AbortSignal.timeout(95000), redirect: 'error',
  });
  if (!response.ok) throw Error('Engine ' + path + ' HTTP ' + response.status);
  return schema.parse(await response.json());
};
await initDriver(graph, '', '', 60, 2000);
const session = getDriver().session();
const tutor = 'completed-lesson-pilot-tutor', actor = 'completed-lesson-pilot-finance', booking = 'completed-lesson-pilot-booking';
try {
  const status = await request('/v1/payouts/prover', proverStatusSchema);
  assert.equal(status.ready, true);
  const release = validatePayoutProofRelease(status.release);
  assert.equal(release.chainId, 42161);
  assert.equal(release.domainId, 10);
  assert.equal(release.verificationNetwork, 'zkVerify');
  assert.equal(status.release.proverBackend, 'rust');
  assert.equal((await authorization.readiness()).submissionsEnabled, true);
  if (live) {
    const account = await request('/v1/zkverify/account', accountSchema);
    assert.equal(account.network, 'zkVerify');
    assert(BigInt(account.account.freeBalance) > 10n ** 18n, 'Insufficient VFY fee reserve');
    assert.equal((await session.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n').toNumber(), 0);
    journal.balanceBefore = account.account.freeBalance;
    journal.stage = 'fixture-intent'; save();
    await session.run(`CREATE (:User {id:$tutor}),(:Student {id:'completed-lesson-pilot-student'}),
      (:Admin {id:$actor,role:'admin',permissions:['finance']}),
      (:Admin {id:'completed-lesson-pilot-support',role:'admin',permissions:['support']})`, { tutor, actor });
    const rate = await rates.save(tutor, { currency: 'USD', amount: '1.23', expectedVersion: 0,
      requestId: crypto.randomUUID(), reason: 'Synthetic proof test only; not actual tutor compensation' }, actor);
    await session.run('MATCH(h:TutorRateChange {id:$id}) SET h.changedAt=$at', {
      id: rate.change.id, at: new Date(Date.now() - 86400000).toISOString(),
    });
    await session.run(`MATCH(s:Student {id:'completed-lesson-pilot-student'})
      CREATE (:Booking {bookingId:$booking,tutorId:$tutor,status:'completed',lessonOutcome:'attended',
      attendanceTutor:'present',attendanceStudent:'present',finalizedAt:$at,
      slotDateTime:datetime($start),durationMinutes:25})-[:BOOKED_BY]->(s)`, {
      booking, tutor, at: new Date(Date.now() - 60000).toISOString(), start: new Date(Date.now() - 1800000).toISOString(),
    });
    await earnings.post(tutor, booking, actor, 'Synthetic completed-lesson proof test; no transfer');
    const reservation = await earnings.reserve(tutor, { requestId: crypto.randomUUID(), bookingIds: [booking],
      recipient: '0x0000000000000000000000000000000000001234', reason: 'Synthetic authorization; never transfer' }, actor);
    journal.batchId = reservation.batch.id; journal.stage = 'reserved'; save();
    await assert.rejects(authorization.generate(tutor, journal.batchId, 'completed-lesson-pilot-support', {}), /Finance/);
    const started = Date.now();
    const proved = await authorization.generate(tutor, journal.batchId, actor, {});
    assert.equal(proved.authorization?.phase, 'locally_proved');
    assert.equal(proved.transferEnabled, false);
    journal.proofGenerationMs = Date.now() - started;
    const raw = (await session.run('MATCH(a:TutorPayoutAuthorization {batchId:$id}) RETURN a', { id: journal.batchId })).records[0]!.get('a').properties;
    const evidence = payoutAuthorizationEvidence(await earnings.evidence(tutor, journal.batchId, actor));
    const proof = JSON.parse(raw.proofJson), publicSignals = JSON.parse(raw.signalsJson);
    const result = { ...status.release, proof, publicSignals, evidenceDigest: raw.evidenceDigest, localVerified: true, transferEnabled: false };
    // Use the real public-output shape expected by the application validator.
    const base = { ...result, protocol: 'fluentxverse.payout-authorization.v2' };
    validatePayoutAuthorization(base, evidence, release);
    const wrongChain = structuredClone(base); wrongChain.publicSignals[5] = '8453';
    assert.throws(() => validatePayoutAuthorization(wrongChain, evidence, release), /binding|release|protocol|policy/i);
    assert.throws(() => validatePayoutAuthorization(base, evidence, release, Number(publicSignals[15]) * 1000 + 1000), /lifetime/);
    const cryptographicQA = execFileSync('node', ['--input-type=module', '-e', `
      import {groth16} from 'snarkjs';
      const chunks=[];for await(const c of process.stdin)chunks.push(c);
      const {vk,proof,signals}=JSON.parse(Buffer.concat(chunks));
      if(!await groth16.verify(vk,signals,proof))throw Error('Original proof invalid');
      const changed=[...signals];changed[5]='8453';
      if(await groth16.verify(vk,changed,proof))throw Error('Changed public input accepted');
      const tampered=structuredClone(proof);tampered.pi_a[0]=(BigInt(tampered.pi_a[0])+1n).toString();
      let accepted=false;try{accepted=await groth16.verify(vk,signals,tampered);}catch{}
      if(accepted)throw Error('Tampered proof accepted');
      console.log(JSON.stringify({originalVerified:true,wrongChainRejected:true,tamperedProofRejected:true}));process.exit(0);
    `], { input: JSON.stringify({ vk: release.vk, proof, signals: publicSignals }), encoding: 'utf8', timeout: 120000 });
    journal.cryptographicQA = JSON.parse(cryptographicQA.trim().split('\n').at(-1)!);
    journal.release = { manifestSHA256: release.releaseManifestSHA256, vkHash: release.vkHash,
      setupPolicy: release.releasePolicy, independentlyReviewed: release.independentlyReviewed };
    journal.stage = 'proved'; save();
    console.log(JSON.stringify({ event: 'locally-proved', proofGenerationMs: journal.proofGenerationMs, checks: journal.cryptographicQA }));
    // Commit paid submission intent before calling Engine. Never automatically resend.
    journal.stage = 'submission-intent'; save();
    const submitted = await authorization.submit(tutor, journal.batchId, actor, {});
    journal.engineSubmissionId = submitted.authorization?.engineSubmissionId;
    assert(journal.engineSubmissionId);
    journal.stage = 'submitted'; save();
    console.log(JSON.stringify({ event: 'submitted', engineSubmissionId: journal.engineSubmissionId }));
  }
  if (journal.stage === 'submission-intent') throw Error('Uncertain submission: inspect Engine; do not resend');
  if (journal.stage !== 'submitted' && journal.stage !== 'complete') throw Error('Pilot needs operator review: ' + journal.stage);
  if (journal.stage !== 'complete') {
    const proof = await request('/v1/zkverify/proofs/' + journal.engineSubmissionId, submissionSchema);
    journal.nativeStatus = proof.submission.status;
    const native = JSON.parse(proof.submission.transactionResult || '{}');
    journal.nativeResult = { status: native.status, txHash: native.txHash, blockHash: native.blockHash,
      statement: native.statement, domainId: native.domainId, aggregationId: native.aggregationId };
    if (!journal.preRelayChecks) {
      await assert.rejects(authorization.submit(tutor, journal.batchId, actor, {}), /Do not resend|unavailable or expired/);
      for (const kind of ['refunded', 'cancelled']) {
        const rejectedBooking = booking + '-' + kind;
        await session.run(`MERGE(b:Booking {bookingId:$id}) SET b.tutorId=$tutor,b.status=$status,
          b.lessonOutcome='attended',b.attendanceTutor='present',b.attendanceStudent='present',
          b.finalizedAt=$at,b.slotDateTime=datetime($start),b.durationMinutes=25,b.refunded=$refunded`, {
          id: rejectedBooking, tutor, status: kind === 'cancelled' ? 'cancelled' : 'completed',
          refunded: kind === 'refunded', at: new Date(Date.now() - 60000).toISOString(),
          start: new Date(Date.now() - 1800000).toISOString(),
        });
        await assert.rejects(earnings.post(tutor, rejectedBooking, actor, 'Synthetic ineligible lesson rejection'), /not finalized and payable/);
      }
      journal.preRelayChecks = { duplicateSubmissionRejected: true, refundedLessonRejected: true, cancelledLessonRejected: true };
      save();
    }
    if (proof.submission.status === 'finalized') {
      const result = await authorization.reconcile(tutor, journal.batchId, actor, {});
      journal.phase = result.authorization?.phase;
      const current = await request('/v1/zkverify/proofs/' + journal.engineSubmissionId, submissionSchema);
      const transaction = JSON.parse(current.submission.transactionResult || '{}');
      journal.receipt = transaction.arbitrumReceipt;
      if (journal.phase === 'receipt_verified') {
        assert(finalizedDestinationReceipt(journal.receipt, 42161));
        await assert.rejects(authorization.submit(tutor, journal.batchId, actor, {}), /Do not resend|unavailable or expired/);
        await session.run('MATCH(b:Booking {bookingId:$booking}) SET b.refunded=true', { booking });
        const refunded = await authorization.reconcile(tutor, journal.batchId, actor, {});
        assert.equal(refunded.currentlyEligible, false);
        assert.equal(refunded.authorization?.phase, 'receipt_verified');
        assert.equal((await session.run("MATCH(e:TutorEarning {status:'paid'}) RETURN count(e) AS n")).records[0]!.get('n').toNumber(), 0);
        journal.checks = { financePermissionEnforced: true, productionKeyProofVerified: true,
          tamperedProofRejected: true, wrongChainRejected: true, expiredAuthorizationRejected: true, nativeFinalized: true,
          officialArbitrumReceiptVerified: true, duplicateSubmissionRejected: true,
          refundedLessonIneligible: true, noEarningsMarkedPaid: true };
        journal.stage = 'complete';
      }
    }
    journal.lastCheckedAt = new Date().toISOString(); save();
  }
  console.log(JSON.stringify({ event: 'pilot-result', ...journal }));
} finally { await session.close(); await closeDriver(); }
process.exit(0);
