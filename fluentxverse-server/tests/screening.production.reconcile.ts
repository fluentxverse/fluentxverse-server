import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { approvedScreeningArtifacts, screeningEngineRequest } from '../src/services/screening/prover';
import { finalizeScreeningValidation, publicScreeningSummary, revokeScreeningCredential } from '../src/services/screening/service';
import { fieldHash } from '../src/services/screening/policy';
import { screeningLeaf } from '../src/services/screening/chain';

// Receipt-only recovery: deliberately imports no issuance, proving or submission function.
if (!/^bolt:\/\/screening-pilot-memgraph:7687$/.test(process.env.TEST_MEMGRAPH_URI || '')) throw Error('Isolated QA Memgraph required');
const path = process.env.SCREENING_PILOT_REPORT!;
const report = JSON.parse(readFileSync(path, 'utf8'));
assert.equal(report.syntheticEvidence, true);
assert.equal(report.negativeTestsPassed, true);
assert.match(report.projectProofId, /^[a-f0-9-]{36}$/);
const release = await approvedScreeningArtifacts();
assert.equal(report.manifestSHA256, release.releaseManifestSHA256);
const { submission } = await screeningEngineRequest(`/v1/zkverify/proofs/${report.projectProofId}`);
assert.equal(submission.status, 'finalized');
assert.equal(submission.zkVerifyNetwork, 'zkVerify');
assert.equal(submission.domainId, 3);
const transaction = JSON.parse(submission.transactionResult), values = JSON.parse(submission.publicSignals);
assert.equal(transaction.txHash, report.zkVerifyTx);
assert.equal(values[1], report.commitment);
assert.equal(transaction.statement, screeningLeaf(release.vkHash as `0x${string}`, values));
const { receipt: reconciliation } = await screeningEngineRequest(`/v1/zkverify/proofs/${report.projectProofId}/receipt`, undefined, 180000);
const save = (patch: any) => writeFileSync(path, JSON.stringify({ ...report, ...patch, updatedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
if (reconciliation?.verifiedOnHorizen !== true) {
  save({ reconciliation });
  console.log(JSON.stringify({ status: reconciliation?.status, verifiedOnHorizen: false, resubmitted: false })); process.exit(0);
}
await initDriver(process.env.TEST_MEMGRAPH_URI!, '', '');
const session = getDriver().session();
try {
  assert.equal(Number((await session.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n')), 0);
  const tutorId = 'synthetic-screening-qa-not-a-real-tutor', actor = 'synthetic-screening-qa-admin';
  assert.equal(values[14], fieldHash({ tutorId }));
  process.env.SCREENING_ENABLED = 'true'; // QA helper only, not production API.
  await session.run(`CREATE(c:TutorScreeningCredential {id:'synthetic-receipt-recovery',tutorId:$tutorId,commitment:$commitment,
    publicSignals:$signals,proof:$proof,shared:true,revoked:false,status:'awaiting_horizen_validation',issuedAt:$issuedAt,
    expiresAt:$expiresAt,zkVerifyTx:$tx,provingReleaseSHA256:$release,proofVKHash:$vk})`, {
    tutorId, commitment: report.commitment, signals: submission.publicSignals, proof: submission.proof, issuedAt: values[9], expiresAt: values[10],
    tx: report.zkVerifyTx, release: release.releaseManifestSHA256, vk: release.vkHash,
  });
  const receipt = reconciliation.receipt, bad = { ...receipt, aggregationId: (BigInt(receipt.aggregationId) + 1n).toString() };
  await assert.rejects(finalizeScreeningValidation(report.commitment, bad, actor));
  assert.equal((await finalizeScreeningValidation(report.commitment, receipt, actor)).certified, true);
  const summary = (await publicScreeningSummary(report.commitment))!;
  assert.equal(summary.certified, true); assert.equal(summary.assurance.independentlyReviewed, false);
  await revokeScreeningCredential(report.commitment, actor);
  assert.equal((await publicScreeningSummary(report.commitment))!.certified, false);
  await assert.rejects(finalizeScreeningValidation(report.commitment, receipt, actor), /revoked/);
  save({ verifiedOnHorizen: true, receipt, reconciliation, pilotCredentialRevoked: true, completedAt: new Date().toISOString(),
    checks: [...report.checks, 'Receipt-only recovery: tampered receipt rejected; actual finalized Horizen bridge receipt accepted',
      'Revocation withdraws public certification and prevents recertification'], resubmitted: false });
  console.log('PASS existing proof reconciled and exact-release certification/revocation tests passed; no new proof or transaction submitted.');
} finally { await session.close(); await closeDriver(); }
process.exit(0);
