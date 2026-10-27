import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { screeningFixture } from './screening.fixture';
import { sealPrivateEvidence, openPrivateEvidence } from '../src/services/screening/storage';
import { approvedScreeningArtifacts, screeningEngineRequest } from '../src/services/screening/prover';
import { issueScreeningCredential, generateScreeningProof, shareScreeningCredential, submitScreeningProof,
  finalizeScreeningValidation, revokeScreeningCredential, publicScreeningSummary } from '../src/services/screening/service';
import { getScreeningCredential } from '../src/services/screening/repository';

if (process.env.RUN_LIVE_SCREENING_PILOT !== 'authorized' || !/^bolt:\/\/(127\.0\.0\.1:\d+|screening-pilot-memgraph:7687)$/.test(process.env.TEST_MEMGRAPH_URI || '')) {
  throw Error('Explicit live-pilot authorization and isolated Memgraph are required');
}
const reportPath = process.env.SCREENING_PILOT_REPORT;
if (!reportPath) throw Error('Pilot report destination required');
await initDriver(process.env.TEST_MEMGRAPH_URI!, '', '');
const session = getDriver().session();
const checks: string[] = [];
const write = (report: any) => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
try {
  assert.equal(Number((await session.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n')), 0, 'Never run the pilot against a populated database');
  process.env.SCREENING_ENABLED = 'true'; // Only this QA process; live API stays disabled until this pilot passes.
  const release = await approvedScreeningArtifacts();
  assert.equal(release.releasePolicy, 'self-operated');
  const e = screeningFixture(), actor = 'synthetic-screening-qa-admin';
  const tutorId = 'synthetic-screening-qa-not-a-real-tutor';
  e.tutorId = e.written.tutorId = e.speaking.tutorId = e.written.result.tutorId = e.speaking.result.tutorId = tutorId;
  const audio = Buffer.alloc(96, 42); // Synthetic bytes, not a claim of real speech or AI grading.
  for (const a of e.speaking.audioEvidence) {
    a.tutorId = tutorId; a.audioHash = createHash('sha256').update(audio).digest('hex');
    a.privateAudioRef = `recording:synthetic-recording:${a.taskId}`;
  }
  await session.run(`CREATE (:Admin {id:$actor,role:'superadmin'}),
    (:ProfileScreeningDecision {id:'synthetic-profile',tutorId:$tutorId,status:'approved',reviewerId:$actor,reviewedAt:$at}),
    (:InterviewSlot {id:$interview,tutorId:$tutorId,status:'completed',result:'pass',reviewedBy:$actor,completedAt:$at}),
    (u:User {id:$tutorId,profileStatus:'approved',profileReviewedBy:$actor,profileScreeningDecisionId:'synthetic-profile',qaSynthetic:true}),
    (w:Exam {id:$written,type:'written',status:'completed',completedAt:$at,content:$wc,result:$wr}),
    (s:Exam {id:$speaking,type:'speaking',status:'completed',completedAt:$at,content:$sc,result:$sr,screeningAudioEvidence:$ae}),
    (u)-[:TAKES]->(w),(u)-[:TAKES]->(s)`, {
    actor, tutorId, at: e.written.completedAt, interview: e.interview.attemptId, written: e.written.attemptId, speaking: e.speaking.attemptId,
    wc: JSON.stringify(e.written.content), wr: JSON.stringify(e.written.result), sc: JSON.stringify(e.speaking.content),
    sr: JSON.stringify(e.speaking.result), ae: JSON.stringify(e.speaking.audioEvidence),
  });
  for (const a of e.speaking.audioEvidence) await session.run(`MATCH(s:Exam {id:$exam}) CREATE(s)-[:HAS_RECORDING]->(:SpeakingRecording {id:$id,tutorId:$tutorId,taskId:$task,encryptedAudio:$audio})`, {
    exam: e.speaking.attemptId, id: a.privateAudioRef.slice(10), tutorId, task: a.taskId,
    audio: sealPrivateEvidence(Buffer.from(JSON.stringify({ audioUrl: 'data:audio/webm;base64,' + audio.toString('base64') })), `oral:${tutorId}:${e.speaking.attemptId}:${a.taskId}`),
  });
  const issued = await issueScreeningCredential(tutorId, actor), commitment = issued.commitment;
  assert.equal((await issueScreeningCredential(tutorId, actor)).commitment, commitment);
  checks.push('Full repository evidence loading and idempotent credential issuance');
  await generateScreeningProof(commitment, actor);
  const stored = (await getScreeningCredential(commitment))!;
  const values = JSON.parse(stored.publicSignals), proof = JSON.parse(stored.proof!);
  // Verify both the real production-key proof and tampered variants in native Node.
  const verification = JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
import{groth16}from'snarkjs';import{readFileSync}from'node:fs';
const{vk,proof,values}=JSON.parse(readFileSync(0,'utf8')),bad=structuredClone(proof),changed=[...values];
bad.pi_a=['1','2','1'];changed[14]=(BigInt(changed[14])+1n).toString();
console.log(JSON.stringify({valid:await groth16.verify(vk,values,proof),tampered:await groth16.verify(vk,values,bad),wrongSubject:await groth16.verify(vk,changed,proof)}));process.exit(0);`], {
    input: JSON.stringify({ vk: release.vk, proof, values }), encoding: 'utf8', timeout: 30000,
  }));
  assert.deepEqual(verification, { valid: true, tampered: false, wrongSubject: false });
  const witness = JSON.parse(openPrivateEvidence(stored.encryptedEvidence, stored.id).toString()).input;
  const badSignature = { ...witness, signatureS: (BigInt(witness.signatureS) + 1n).toString() };
  await assert.rejects(screeningEngineRequest('/v1/screening/proofs', { input: badSignature, publicSignals: values }, 200000));
  checks.push('Production-key proof accepted; tampered proof and wrong subject rejected cryptographically');
  checks.push('Production Engine prover rejects an altered issuer signature');
  await assert.rejects(submitScreeningProof(commitment, actor), /consent/);
  await shareScreeningCredential(tutorId, commitment, true);
  const changeSignals = async (signals: string[]) => session.run('MATCH(c:TutorScreeningCredential) SET c.publicSignals=$signals', { signals: JSON.stringify(signals) });
  const expired = [...values]; expired[9] = '1'; expired[10] = '31536001';
  await changeSignals(expired); await assert.rejects(submitScreeningProof(commitment, actor), /Expired/); await changeSignals(values);
  const wrongNetwork = [...values]; wrongNetwork[11] = '2651420';
  await changeSignals(wrongNetwork); await assert.rejects(submitScreeningProof(commitment, actor), /destination/); await changeSignals(values);
  const wrongIssuer = [...values]; wrongIssuer[4] = '1';
  await changeSignals(wrongIssuer); await assert.rejects(submitScreeningProof(commitment, actor), /issuer/); await changeSignals(values);
  await session.run('MATCH(c:TutorScreeningCredential) SET c.revoked=true');
  await assert.rejects(submitScreeningProof(commitment, actor), /revoked/);
  await session.run('MATCH(c:TutorScreeningCredential) SET c.revoked=false');
  checks.push('Missing consent, expired, wrong network, wrong issuer and revoked credentials rejected before submission');
  // Wrong bindings and expired statements are rejected by Engine's submission endpoint,
  // before persistence/signing. No invalid proof is deliberately sent to the chain.
  for (const signals of [expired, wrongNetwork, wrongIssuer]) await assert.rejects(screeningEngineRequest('/v1/zkverify/proofs', {
    proof, publicSignals: signals, vk: release.vk, domainId: 3, proofSystem: 'groth16', curve: 'bn128', expectedNetwork: 'zkVerify',
  }));
  checks.push('Engine independently rejects expired and wrongly bound submission requests');
  if (process.env.SCREENING_PILOT_OFFLINE_ONLY === 'true') {
    write({ preflightPassed: true, syntheticEvidence: true, manifestSHA256: release.releaseManifestSHA256, checks, chainTransactions: 0 });
    console.log('PASS isolated application issuance/proving/rejection preflight; no chain transaction submitted.');
    await session.close(); await closeDriver(); process.exit(0);
  }
  write({ syntheticEvidence: true, manifestSHA256: release.releaseManifestSHA256, commitment,
    status: 'submission-authorized-reconcile-before-retry', verifiedOnHorizen: false, checks });
  const submitted = await submitScreeningProof(commitment, actor);
  const after = (await getScreeningCredential(commitment))! as any;
  assert.ok(after.engineSubmissionId);
  const submissionId = after.engineSubmissionId;
  const duplicate = await submitScreeningProof(commitment, actor);
  assert.equal(duplicate.zkVerifyTx, submitted.zkVerifyTx);
  checks.push('One real mainnet submission; repeat application submission returns the existing transaction');
  const baseReport = { syntheticEvidence: true, realTutorCertified: false, manifestSHA256: release.releaseManifestSHA256,
    releasePolicy: release.releasePolicy, independentlyAudited: false, projectProofId: submissionId, commitment,
    zkVerifyTx: submitted.zkVerifyTx, verifiedOnZkVerify: true, verifiedOnHorizen: false, negativeTestsPassed: true, checks };
  write(baseReport);
  console.log(JSON.stringify({ event: 'native-proof-finalized', submissionId, txHash: submitted.zkVerifyTx, syntheticEvidence: true }));
  let reconciliation: any;
  for (let attempt = 0; attempt < 180; attempt++) {
    try {
      const result = await screeningEngineRequest(`/v1/zkverify/proofs/${submissionId}/receipt`, undefined, 180000);
      reconciliation = result.receipt;
      if (reconciliation?.verifiedOnHorizen === true) break;
      write({ ...baseReport, reconciliation, updatedAt: new Date().toISOString() });
      console.log(JSON.stringify({ event: 'receipt-pending', attempt, status: reconciliation?.status }));
    } catch { console.log(JSON.stringify({ event: 'receipt-retry', attempt, resubmitted: false })); }
    await Bun.sleep(20000);
  }
  if (!reconciliation?.verifiedOnHorizen) throw Error('Official Horizen relay/finality not yet verified; do not enable certification or resubmit the proof');
  const receipt = reconciliation.receipt;
  const tamperedReceipt = { ...receipt, merklePath: [...receipt.merklePath] };
  if (tamperedReceipt.merklePath.length) tamperedReceipt.merklePath[0] = '0x' + '00'.repeat(32);
  else tamperedReceipt.aggregationId = (BigInt(receipt.aggregationId) + 1n).toString();
  await assert.rejects(finalizeScreeningValidation(commitment, tamperedReceipt, actor));
  assert.equal((await finalizeScreeningValidation(commitment, receipt, actor)).certified, true);
  const summary = (await publicScreeningSummary(commitment))!;
  assert.equal(summary.certified, true);
  assert.equal(summary.assurance.independentlyReviewed, false);
  assert.ok(!JSON.stringify(summary).includes('Server transcribed fixture.'));
  checks.push('Tampered receipt rejected; actual finalized official Horizen bridge receipt accepted');
  await revokeScreeningCredential(commitment, actor);
  assert.equal((await publicScreeningSummary(commitment))!.certified, false);
  await assert.rejects(finalizeScreeningValidation(commitment, receipt, actor), /revoked/);
  checks.push('Revocation withdraws public certification and prevents recertification');
  write({ ...baseReport, checks, verifiedOnHorizen: true, receipt, reconciliation, pilotCredentialRevoked: true, completedAt: new Date().toISOString() });
  console.log('PASS exact production release: real zkVerify mainnet proof and official Horizen receipt; synthetic credential revoked; lifecycle and tampering checks passed.');
} finally { await session.close(); await closeDriver(); }
process.exit(0);
