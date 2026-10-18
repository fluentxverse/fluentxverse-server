import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tallyFixture } from './reviewTally.fixture';
import { ReviewTallyProver } from '../src/services/anonymousReviews/tallyProver';

const binary = new URL('../../zk/review-tally/target/release/review-tally-host', import.meta.url).pathname;
const metadata = JSON.parse(execFileSync(binary, ['metadata'], { encoding: 'utf8' }));
process.env.ANONYMOUS_REVIEW_TALLY_ENABLED = 'true'; process.env.ANONYMOUS_REVIEWS_DEPLOYMENT_BLOCK = '10';
process.env.ANONYMOUS_REVIEW_TALLY_IMAGE_ID = metadata.imageId; process.env.ANONYMOUS_REVIEW_TALLY_PROVER = binary;
process.env.ANONYMOUS_REVIEW_TALLY_PROVER_SHA256 = createHash('sha256').update(readFileSync(binary)).digest('hex');
delete process.env.ANONYMOUS_REVIEW_TALLY_PROVER_URL;
const fixture = tallyFixture(), prover = new ReviewTallyProver(), start = Date.now();
const proof = await prover.prove(fixture.witness);
assert.equal(proof.publicSignals, fixture.journal);
await prover.verify(proof);
const altered = { ...proof, publicSignals: `${proof.publicSignals.slice(0, -2)}ff` as `0x${string}` };
await assert.rejects(prover.verify(altered));
await assert.rejects(prover.verify({ ...proof, proof: '0x00' }));
writeFileSync(new URL('../../zk/review-tally/target/synthetic-proof.json', import.meta.url), JSON.stringify({ synthetic: true, ...proof }), { mode: 0o600 });
console.log(JSON.stringify({ passed: true, realZkvmProof: true, synthetic: true, imageId: proof.vk, journalBytes: (proof.publicSignals.length - 2) / 2,
  proofBytes: (proof.proof.length - 2) / 2, elapsedSeconds: Math.round((Date.now() - start) / 1000) }));
