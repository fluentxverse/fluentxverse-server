import { afterEach, expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tallyFixture } from './reviewTally.fixture';
import { tallyJournal, tallyManifestHash, tallyStatement, type TallyProof } from '../src/services/anonymousReviews/tallyPolicy';
import { AnonymousReviewRepository, type ReviewCohort, type ReviewTallyRecord } from '../src/services/anonymousReviews/repository';
import { AnonymousReviewTally } from '../src/services/anonymousReviews/tally';
import { encryptReview } from '../src/services/anonymousReviews/storage';
import { AnonymousReviewService } from '../src/services/anonymousReviews/service';

const saved = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
function setup() {
  process.env.PRIVACY_INFRA_MODE = 'bridge_only';
  process.env.ANONYMOUS_REVIEWS_ENABLED = 'true'; process.env.ANONYMOUS_REVIEW_TALLY_ENABLED = 'true';
  process.env.ANONYMOUS_REVIEW_TALLY_IMAGE_ID = `0x${'ef'.repeat(32)}`;
  process.env.ANONYMOUS_REVIEWS_DEPLOYMENT_BLOCK = '10'; process.env.ANONYMOUS_REVIEWS_ENCRYPTION_KEY = '12'.repeat(32);
  const fixture = tallyFixture(), repo = new AnonymousReviewRepository(), tally = new AnonymousReviewTally(repo);
  const { snapshot } = fixture.witness;
  const cohort = { id: snapshot.groupId, tutorId: 'synthetic-tutor', period: '2020-01', scope: fixture.scope, chainId: snapshot.chainId,
    contract: snapshot.registry, root: BigInt(snapshot.root).toString(), membersJson: JSON.stringify(fixture.members),
    opensAt: '2020-02-01T00:00:00Z', closesAt: '2020-02-08T00:00:00Z' } as ReviewCohort;
  const record: ReviewTallyRecord = { id: cohort.id, status: 'proof_ready', manifestJson: JSON.stringify(snapshot), totalsJson: JSON.stringify(fixture.totals),
    journal: fixture.journal, encryptedWitness: encryptReview(fixture.witness, `tally:${cohort.id}`),
    imageId: process.env.ANONYMOUS_REVIEW_TALLY_IMAGE_ID,
    proofJson: JSON.stringify({ proof: '0x01', publicSignals: fixture.journal, vk: process.env.ANONYMOUS_REVIEW_TALLY_IMAGE_ID,
      version: 'V2_3', proofSystem: 'risc0', localVerified: true }), zkVerifyTx: `0x${'aa'.repeat(32)}` };
  return { fixture, repo, tally, cohort, record };
}
test('manifest and journal bind the exact ordered acceptance set, deployment and every aggregate total', () => {
  const { witness: { snapshot }, totals, journal } = tallyFixture();
  expect(journal.length).toBe(2 + 31 * 64);
  expect(() => tallyManifestHash({ ...snapshot, accepted: [snapshot.accepted[0]!, ...snapshot.accepted.slice(0, 4)] })).toThrow();
  expect(() => tallyManifestHash({ ...snapshot, accepted: [...snapshot.accepted].reverse() })).toThrow();
  expect(() => tallyManifestHash({ ...snapshot, blockTimestamp: snapshot.closesAt - 1 })).toThrow();
  expect(() => tallyManifestHash({ ...snapshot, accepted: snapshot.accepted.slice(0, 4) })).toThrow();
  expect(() => tallyManifestHash({ ...snapshot, accepted: snapshot.accepted.map((v, i) => i ? v : { ...v, statement: `0x${'0'.repeat(64)}` }) })).toThrow();
  expect(() => tallyJournal(snapshot, { ...totals, ratingSum: totals.ratingSum + 1 })).toThrow();
  expect(() => tallyJournal(snapshot, { ...totals, total: 6 })).toThrow();
  expect(tallyJournal({ ...snapshot, blockNumber: 31 }, totals)).not.toBe(journal);
  expect(tallyStatement(`0x${'ef'.repeat(32)}`, journal)).not.toBe(tallyStatement(`0x${'ee'.repeat(32)}`, journal));
  expect(() => tallyManifestHash({ ...snapshot, studentId: 'private' } as any)).toThrow('Unexpected');
  expect(() => tallyJournal(snapshot, { ...totals, contents: [] } as any)).toThrow('Unexpected');
});

const native = new URL('../../zk/review-tally/target/debug/examples/check', import.meta.url).pathname;
test.skipIf(!existsSync(native))('native Rust guest policy matches TypeScript encoding and rejects changed private content', () => {
  const fixture = tallyFixture();
  const evaluate = (input: unknown) => JSON.parse(execFileSync(native, { input: JSON.stringify(input), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
  expect(evaluate(fixture.witness)).toEqual({ totals: fixture.totals, journal: fixture.journal });
  for (const mutate of [
    (input: any) => input.contents[0].rating = 5,
    (input: any) => input.contents[0].salt = 'f'.repeat(64),
    (input: any) => input.contents[0].positive = [],
    (input: any) => input.contents[0].improvement = [],
    (input: any) => input.contents.pop(),
    (input: any) => input.contents[0].studentId = 'must-not-be-accepted',
  ]) { const input = structuredClone(fixture.witness); mutate(input); expect(() => evaluate(input)).toThrow(); }
});
test('publication requires finalized receipt, census completeness and exact journal; legacy batches stay distinct', async () => {
  const { fixture, repo, tally, cohort, record } = setup();
  const receipt = { aggregationId: '10', leafCount: '1', index: '0', merklePath: [] };
  const get = spyOn(repo, 'cohort').mockResolvedValue(cohort), read = spyOn(repo, 'tally').mockResolvedValue(record);
  const complete = spyOn(tally.source, 'complete').mockResolvedValue(), bridge = spyOn(tally.source, 'receipt').mockResolvedValue(false);
  const patch = spyOn(repo, 'patchTally').mockImplementation(async (_id, values) => { Object.assign(record, values); });
  const certify = spyOn(repo, 'certifyTally').mockImplementation(async (_id, json) => { record.status = 'certified'; record.receiptJson = json; });
  const save = spyOn(repo, 'saveSummary').mockImplementation(async (_id, json) => { cohort.summaryJson ??= json; return cohort; });
  try {
    await expect(tally.publish(cohort.id)).rejects.toThrow('Certify');
    await expect(tally.certify(cohort.id, receipt)).rejects.toThrow('Horizen finality'); expect(patch).not.toHaveBeenCalled();
    bridge.mockResolvedValue(true); complete.mockRejectedValue(new Error('omitted review'));
    await expect(tally.certify(cohort.id, receipt)).rejects.toThrow('omitted review');
    complete.mockResolvedValue(); await tally.certify(cohort.id, receipt); await tally.publish(cohort.id);
    const evidence = await tally.publicEvidence(cohort.id);
    expect(evidence.verified).toBe(true); expect(evidence.totals).toEqual(fixture.totals);
    expect(JSON.stringify(evidence)).not.toContain('encryptedWitness'); expect(JSON.stringify(evidence)).not.toContain('"salt"');
    record.totalsJson = JSON.stringify({ ...fixture.totals, ratingSum: 16 }); await expect(tally.publicEvidence(cohort.id)).rejects.toThrow('Invalid tally totals');
    record.totalsJson = JSON.stringify(fixture.totals); bridge.mockResolvedValue(false); await expect(tally.publicEvidence(cohort.id)).rejects.toThrow('finality');
    cohort.summaryJson = JSON.stringify({ total: 5, average: 5 }); bridge.mockResolvedValue(true);
    await expect(tally.publish(cohort.id)).rejects.toThrow('immutable');
  } finally { for (const mock of [get, read, complete, bridge, patch, certify, save]) mock.mockRestore(); }
});
test('accepted reviews without private content block preparation instead of silently reducing the tally', async () => {
  const { fixture, repo, tally, cohort } = setup();
  const get = spyOn(repo, 'cohort').mockResolvedValue(cohort), read = spyOn(repo, 'tally').mockResolvedValue(null);
  const collect = spyOn(tally.source, 'collect').mockResolvedValue(fixture.witness.snapshot), list = spyOn(repo, 'submissions').mockResolvedValue([]);
  const save = spyOn(repo, 'saveTally').mockResolvedValue({} as any);
  try { await expect(tally.prepare(cohort.id)).rejects.toThrow('partial publication is forbidden'); expect(save).not.toHaveBeenCalled(); }
  finally { for (const mock of [get, read, collect, list, save]) mock.mockRestore(); }
});
test('changed prover journal fails, releases only local proving state and cannot be submitted', async () => {
  const { fixture, repo, tally, cohort, record } = setup();
  const get = spyOn(repo, 'cohort').mockResolvedValue(cohort), claim = spyOn(repo, 'claimTally').mockResolvedValue(record);
  const prover = spyOn(tally.prover, 'prove').mockResolvedValue({ publicSignals: '0x00' } as unknown as TallyProof);
  const patch = spyOn(repo, 'patchTally').mockResolvedValue();
  try { await expect(tally.prove(cohort.id)).rejects.toThrow('immutable snapshot'); expect(patch).toHaveBeenCalledWith(cohort.id, { status: 'proof_failed' }); }
  finally { for (const mock of [get, claim, prover, patch]) mock.mockRestore(); }
});
test('enabling the tally upgrade blocks new platform-only publication without relabeling existing batches', async () => {
  const { repo, tally, cohort } = setup(), service = new AnonymousReviewService(repo, undefined, tally);
  const get = spyOn(repo, 'cohort').mockResolvedValue(cohort), publish = spyOn(tally, 'publish').mockRejectedValue(new Error('proof required'));
  const active = spyOn(service.chain, 'active').mockResolvedValue(true);
  try {
    await expect(service.publish(cohort.id)).rejects.toThrow('proof required');
    cohort.summaryJson = JSON.stringify({ total: 5, average: 3 });
    expect((await service.publish(cohort.id)).tally.status).toBe('platform_calculated');
    expect(publish).toHaveBeenCalledTimes(1);
  } finally { for (const mock of [get, publish, active]) mock.mockRestore(); }
});
