import assert from 'node:assert/strict';
import { tallyFixture } from './reviewTally.fixture';
import { initDriver, closeDriver } from '../src/db/memgraph';
import { AnonymousReviewRepository } from '../src/services/anonymousReviews/repository';
import { AnonymousReviewTally } from '../src/services/anonymousReviews/tally';
import { encryptReview } from '../src/services/anonymousReviews/storage';
import { reviewMessage } from '../src/services/anonymousReviews/policy';
import { tallyStatement, type TallyProof } from '../src/services/anonymousReviews/tallyPolicy';

// Hardcoded EMPTY disposable database, never the live application database.
await initDriver('bolt://127.0.0.1:7702', '', '', 1);
process.env.ANONYMOUS_REVIEWS_ENABLED = 'true'; process.env.ANONYMOUS_REVIEW_TALLY_ENABLED = 'true';
process.env.PRIVACY_INFRA_MODE = 'legacy_contracts';
process.env.ANONYMOUS_REVIEW_TALLY_IMAGE_ID = `0x${'ef'.repeat(32)}`; process.env.ANONYMOUS_REVIEWS_DEPLOYMENT_BLOCK = '10';
process.env.ANONYMOUS_REVIEWS_DOMAIN_ID = '175'; process.env.ANONYMOUS_REVIEWS_ENCRYPTION_KEY = '12'.repeat(32);
process.env.GMR_ANONYMOUS_TALLY_ENGINE_API_BASE = 'http://synthetic-engine.test'; process.env.GMR_ANONYMOUS_TALLY_ENGINE_API_KEY = 'synthetic-key';
const f = tallyFixture(), s = f.witness.snapshot, repo = new AnonymousReviewRepository(), tally = new AnonymousReviewTally(repo);
const originalFetch = globalThis.fetch;
let receiptValid = false, broadcasts = 0;
try {
  const count = (await repo.read('MATCH (n) RETURN count(n) AS total')).records[0]!.get('total').toNumber();
  assert.equal(count, 0, 'Requires an empty disposable database');
  const cohort = { id: s.groupId, tutorId: 'synthetic-tutor', period: '2020-01', scope: f.scope, chainId: s.chainId, contract: s.registry,
    root: BigInt(s.root).toString(), membersJson: JSON.stringify(f.members), opensAt: '2020-02-01T00:00:00.000Z', closesAt: '2020-02-08T00:00:00.000Z' };
  await repo.read('CREATE (g:AnonymousReviewCohort) SET g += $cohort', { cohort });
  for (let i = 0; i < f.witness.contents.length; i++) {
    const content = f.witness.contents[i]!, id = `synthetic-review-${i}`, nullifier = String(i + 1);
    await repo.saveSubmission({ id, groupId: s.groupId, nullifier, encryptedContent: encryptReview(content, id), status: 'awaiting_horizen',
      proofJson: JSON.stringify({ merkleTreeDepth: 8, merkleTreeRoot: cohort.root, nullifier, scope: f.scope, message: reviewMessage(s.groupId, content), points: Array(8).fill('0') }) });
  }
  tally.source.collect = async () => s; tally.source.complete = async (_cohort, snapshot) => { assert.deepEqual(snapshot, s); };
  tally.source.receipt = async () => receiptValid;
  await tally.prepare(s.groupId); const prepared = (await repo.tally(s.groupId))!;
  assert(!prepared.encryptedWitness.includes('salt')); assert(!prepared.encryptedWitness.includes('rating'));
  await tally.prepare(s.groupId); assert.equal((await repo.tally(s.groupId))!.encryptedWitness, prepared.encryptedWitness);
  await assert.rejects(repo.saveTally({ ...prepared, journal: '0x00' }), /immutable/);
  const claims = await Promise.all([repo.claimTally(s.groupId, ['prepared'], 'proving'), repo.claimTally(s.groupId, ['prepared'], 'proving')]);
  assert.equal(claims.filter(Boolean).length, 1, 'Only one local proof job can claim the record');
  await repo.patchTally(s.groupId, { status: 'prepared' });
  const proof: TallyProof = { proof: '0x01', publicSignals: f.journal, vk: process.env.ANONYMOUS_REVIEW_TALLY_IMAGE_ID as `0x${string}`,
    version: 'V2_3', proofSystem: 'risc0', localVerified: true };
  tally.prover.prove = async () => proof; tally.prover.verify = async () => {};
  await tally.prove(s.groupId);
  globalThis.fetch = (async (_url: any, options: any) => {
    broadcasts++; const payload = JSON.parse(options.body);
    assert.equal(payload.publicSignals, f.journal); assert(!JSON.stringify(payload).includes('"salt"'));
    assert.equal(payload.version, 'V2_3');
    return Response.json({ submission: { id: 'synthetic-submission', zkVerifyNetwork: 'Volta',
      transactionResult: JSON.stringify({ txHash: `0x${'aa'.repeat(32)}`, statement: tallyStatement(proof.vk, f.journal) }) } });
  }) as typeof fetch;
  await tally.submit(s.groupId); await tally.submit(s.groupId); assert.equal(broadcasts, 1);
  const receipt = { aggregationId: '10', leafCount: '1', index: '0', merklePath: [] };
  await assert.rejects(tally.certify(s.groupId, receipt), /finality/);
  assert.equal((await repo.tally(s.groupId))!.status, 'awaiting_horizen');
  receiptValid = true;
  const certifications = await Promise.allSettled([repo.certifyTally(s.groupId, JSON.stringify(receipt)),
    repo.certifyTally(s.groupId, JSON.stringify({ ...receipt, aggregationId: '11' }))]);
  assert.equal(certifications.filter(v => v.status === 'fulfilled').length, 1, 'Concurrent certification cannot replace a receipt');
  const frozenReceipt = JSON.parse((await repo.tally(s.groupId))!.receiptJson!);
  await tally.certify(s.groupId, frozenReceipt); await tally.publish(s.groupId); await tally.publish(s.groupId);
  const evidence = await tally.publicEvidence(s.groupId); assert.equal(evidence.verified, true); assert.equal(evidence.totals.ratingSum, 15);
  assert(!JSON.stringify(evidence).includes('encryptedWitness')); assert(!JSON.stringify(evidence).includes('"salt"'));
  receiptValid = false; await assert.rejects(tally.publicEvidence(s.groupId), /finality/);
  console.log('PASS: isolated persistence, immutable snapshot, encrypted witness, concurrent proof claims, single submission, fail-closed publication and public evidence. Engine/proofs/receipts mocked.');
} finally { globalThis.fetch = originalFetch; await closeDriver(); }
