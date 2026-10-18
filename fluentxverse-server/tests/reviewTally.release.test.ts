import { expect, test } from 'bun:test';
import { isTallyReceiptPublication, validateTallyReleaseEvidence } from '../scripts/review-tally-release-policy';
import { tallyFixture } from './reviewTally.fixture';
import { tallyStatement, type TallyProof } from '../src/services/anonymousReviews/tallyPolicy';

test('release evidence binds the complete cohort, program, totals, journal and proof before any activation', () => {
  const fixture = tallyFixture(), imageId = `0x${'12'.repeat(32)}` as `0x${string}`;
  const evidence = { protocol: 'fluentxverse.review-tally.v1', imageId, cohort: { id: fixture.witness.snapshot.groupId },
    manifest: fixture.witness.snapshot, manifestHash: fixture.manifestHash, totals: fixture.totals, journal: fixture.journal,
    statement: tallyStatement(imageId, fixture.journal),
    proof: { proofSystem: 'risc0', version: 'V2_3', localVerified: true, vk: imageId, publicSignals: fixture.journal, proof: '0x01' } as TallyProof,
    receipt: { aggregationId: '1', leafCount: '1', index: '0', merklePath: [] } };
  // Structural validation is only a preflight; cryptographic, source census and bridge checks remain mandatory.
  expect(validateTallyReleaseEvidence(evidence, imageId)).toEqual(evidence.proof);
  expect(() => validateTallyReleaseEvidence({ ...evidence, imageId: `0x${'13'.repeat(32)}` }, imageId)).toThrow();
  expect(() => validateTallyReleaseEvidence({ ...evidence, cohort: { id: 'different' } }, imageId)).toThrow();
  expect(() => validateTallyReleaseEvidence({ ...evidence, totals: { ...evidence.totals, ratingSum: 20 } }, imageId)).toThrow();
  expect(() => validateTallyReleaseEvidence({ ...evidence, manifest: { ...evidence.manifest, accepted: evidence.manifest.accepted.slice(1) } }, imageId)).toThrow();
  expect(() => validateTallyReleaseEvidence({ ...evidence, proof: { ...evidence.proof, publicSignals: `${fixture.journal.slice(0, -2)}ff` } }, imageId)).toThrow();
  expect(() => validateTallyReleaseEvidence({ ...evidence, receipt: { ...evidence.receipt, index: '1' } }, imageId)).toThrow();
  expect(() => validateTallyReleaseEvidence({ verified: true, synthetic: true }, imageId)).toThrow();
});

test('receipt discovery matches only the exact domain and aggregation publication event', () => {
  const event = { section: 'aggregate', method: 'NewAggregationReceipt', data: [175, 1214] };
  expect(isTallyReceiptPublication(event, 1214)).toBe(true);
  expect(isTallyReceiptPublication({ ...event, data: [174, 1214] }, 1214)).toBe(false);
  expect(isTallyReceiptPublication(event, 1213)).toBe(false);
  expect(isTallyReceiptPublication({ ...event, method: 'NewProof' }, 1214)).toBe(false);
  expect(isTallyReceiptPublication({ ...event, section: 'settlementRisc0Pallet' }, 1214)).toBe(false);
});
