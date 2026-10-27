import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Identity } from '@semaphore-protocol/identity';
import { initDriver, closeDriver } from '../src/db/memgraph';
import { AnonymousReviewRepository } from '../src/services/anonymousReviews/repository';
import { AnonymousReviewChain } from '../src/services/anonymousReviews/chain';
import { AnonymousReviewService } from '../src/services/anonymousReviews/service';
import { reviewGroupId } from '../src/services/anonymousReviews/policy';
import { reviewPeriod } from '../src/shared/anonymousReviews';

// Never target the live application database.
await initDriver('bolt://127.0.0.1:7701', '', '', 2, 1000);
process.env.PRIVACY_INFRA_MODE = 'legacy_contracts';
process.env.ANONYMOUS_REVIEWS_ENABLED = 'true'; process.env.ANONYMOUS_REVIEWS_CONTRACT = `0x${'1'.repeat(40)}`;
process.env.ANONYMOUS_REVIEWS_BRIDGE = `0x${'2'.repeat(40)}`; process.env.ANONYMOUS_REVIEWS_DOMAIN_ID = '175';
process.env.ANONYMOUS_REVIEWS_RPC_URL = 'http://127.0.0.1:1'; process.env.ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH = `0x${'a'.repeat(64)}`;
process.env.ANONYMOUS_REVIEWS_WASM_SHA256 = 'a'.repeat(64); process.env.ANONYMOUS_REVIEWS_ZKEY_SHA256 = 'b'.repeat(64);
process.env.ANONYMOUS_REVIEWS_ENCRYPTION_KEY = '12'.repeat(32);
const keys = JSON.parse(readFileSync(new URL('../src/verification-keys.json', import.meta.resolve('@semaphore-protocol/proof')), 'utf8'));
const vk = { ...keys, vk_delta_2: keys.vk_delta_2[7], IC: keys.IC[7] };
process.env.ANONYMOUS_REVIEWS_VK_SHA256 = createHash('sha256').update(JSON.stringify(vk)).digest('hex');
const repo = new AnonymousReviewRepository(), chain = new AnonymousReviewChain(), service = new AnonymousReviewService(repo, chain);
let activated = false, accepted = false;
chain.check = async () => ({} as any); chain.active = async () => activated;
chain.activate = async () => ({ id: 'activation-test', status: 'queued' });
chain.accepted = async () => accepted; chain.certify = async () => ({ id: 'certification-test', status: 'queued' });
try {
  const count = (await repo.read('MATCH (n) RETURN count(n) AS count')).records[0]!.get('count').toNumber();
  assert.equal(count, 0, 'Requires an empty disposable database');
  const startsAt = new Date(Date.now() - 3600_000).toISOString(), groupId = reviewGroupId('tutor', reviewPeriod(startsAt));
  for (let i = 0; i < 5; i++) await repo.read(`CREATE (s:Student {id: $student})
    CREATE (b:Booking {bookingId: $booking, tutorId: 'tutor', status: 'completed', attendanceStudent: 'present',
      attendanceTutor: 'present', slotDateTime: datetime($startsAt), durationMinutes: 25}) CREATE (b)-[:BOOKED_BY]->(s)`,
    { student: `s${i}`, booking: `b${i}`, startsAt });
  const identities = Array.from({ length: 5 }, (_, i) => new Identity(`anonymous-review-test-only-${i}`));
  await assert.rejects(service.enroll('b0', 's1', identities[0]!.commitment.toString()), /Lesson not found/);
  await service.enroll('b0', 's0', identities[0]!.commitment.toString());
  await service.enroll('b0', 's0', identities[0]!.commitment.toString());
  await assert.rejects(service.enroll('b0', 's0', '123'), /Restore your original/);
  await assert.rejects(service.enroll('b1', 's1', identities[0]!.commitment.toString()), /already enrolled/);
  for (let i = 1; i < 5; i++) await service.enroll(`b${i}`, `s${i}`, identities[i]!.commitment.toString());
  assert.equal((await repo.read('MATCH (e:AnonymousReviewEnrollment) RETURN count(e) AS count')).records[0]!.get('count').toNumber(), 5);
  assert.equal((await service.mine('s0')).length, 1);
  assert.deepEqual((await service.group(groupId)).members, [], 'Growing membership must not be public');
  const opensAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 3600_000).toISOString();
  const closesAt = new Date(Date.parse(opensAt) + 7 * 86400_000).toISOString();
  await repo.read('MATCH (g:AnonymousReviewCohort {id: $id}) SET g.opensAt = $opensAt, g.closesAt = $closesAt', { id: groupId, opensAt, closesAt });
  await service.activate(groupId);
  assert.equal((await repo.cohort(groupId))?.activationTransactionId, 'activation-test');
  await assert.rejects(service.activate(groupId), /Activation is pending/);
  activated = true;
  const group = await service.group(groupId); assert.equal(group.state, 'open'); assert.equal(group.members.length, 5);
  const fixture = JSON.parse(execFileSync('node', [new URL('../../contracts/anonymous-reviews/fixture.mjs', import.meta.url).pathname,
    process.env.ANONYMOUS_REVIEWS_CONTRACT!, groupId], { encoding: 'utf8', timeout: 120_000 }));
  assert.equal(fixture.proof.merkleTreeRoot, group.root);
  const first = await service.receive(groupId, fixture.content, fixture.proof);
  const retry = await service.receive(groupId, fixture.content, fixture.proof); assert.equal(first.id, retry.id);
  await assert.rejects(service.receive(groupId, { ...fixture.content, rating: 1 }, fixture.proof), /does not match/);
  const stored = (await repo.submission(first.id))!;
  for (const field of ['studentId', 'bookingId', 'createdAt', 'commitment', 'ip', 'cookie']) assert(!(field in stored));
  assert(!stored.encryptedContent.includes('feedback'));
  assert((await repo.claimSubmission(first.id)) !== undefined); assert.equal(await repo.claimSubmission(first.id), undefined);
  await assert.rejects(service.submit(first.id), /needs reconciliation/);
  await repo.patch(first.id, { status: 'awaiting_horizen', zkVerifyTx: `0x${'d'.repeat(64)}` });
  await assert.rejects(service.certify(first.id, { aggregationId: '1', merklePath: [], leafCount: '0', index: '0' }), /Invalid aggregation receipt/);
  assert.equal((await repo.submission(first.id))?.status, 'awaiting_horizen');
  await service.certify(first.id, { aggregationId: '1', merklePath: [], leafCount: '1', index: '0' });
  await assert.rejects(service.certify(first.id, { aggregationId: '1', merklePath: [], leafCount: '1', index: '0' }), /Certification is pending/);
  accepted = true; assert.equal((await service.status(first.id)).verified, true);
  console.log('PASS: isolated Memgraph ownership, immutable enrollment, duplicate identity prevention, frozen cohort, real proof intake, idempotency, encrypted unlinked storage and submission CAS. Chain actions are mocked.');
} finally { await closeDriver(); }
