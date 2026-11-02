import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

if (process.env.PER_LESSON_REVIEW_TEST !== '1') throw new Error('Use PER_LESSON_REVIEW_TEST=1 with the empty disposable graph on port 7798.');
Object.assign(process.env, { PRIVACY_INFRA_MODE: 'bridge_only', PROOF_DESTINATION_MODE: 'static', ANONYMOUS_REVIEWS_ENABLED: 'true',
  ANONYMOUS_REVIEWS_CHAIN_ID: '2651420', ANONYMOUS_REVIEWS_BRIDGE: '0x3098A6974649478f0133046e44105AA84e868C21',
  ANONYMOUS_REVIEWS_DOMAIN_ID: '175', ANONYMOUS_REVIEWS_RPC_URL: 'http://127.0.0.1:1',
  ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH: '0x' + 'a'.repeat(64), ANONYMOUS_REVIEWS_WASM_SHA256: 'a'.repeat(64),
  ANONYMOUS_REVIEWS_ZKEY_SHA256: 'b'.repeat(64), ANONYMOUS_REVIEWS_ENCRYPTION_KEY: '12'.repeat(32) });
const { initDriver, getDriver, closeDriver } = await import('../src/db/memgraph');
const { AnonymousReviewRepository } = await import('../src/services/anonymousReviews/repository');
const { AnonymousReviewChain } = await import('../src/services/anonymousReviews/chain');
const { AnonymousReviewService } = await import('../src/services/anonymousReviews/service');
const { reviewConfig, reviewGroupId, reviewScope } = await import('../src/services/anonymousReviews/policy');
const { reviewPeriod, reviewWindow } = await import('../src/shared/anonymousReviews');
const { Identity } = await import('@semaphore-protocol/identity');
const keys = JSON.parse(readFileSync(new URL('../src/verification-keys.json', import.meta.resolve('@semaphore-protocol/proof')), 'utf8'));
process.env.ANONYMOUS_REVIEWS_VK_SHA256 = createHash('sha256').update(JSON.stringify({ ...keys, vk_delta_2: keys.vk_delta_2[7], IC: keys.IC[7] })).digest('hex');
const prefix = `per-lesson-review-${crypto.randomUUID()}`, id = (name: string) => `${prefix}-${name}`;
const originalNow = Date.now;
const start = new Date(originalNow() - 3600_000).toISOString(), period = reviewPeriod(start), window = reviewWindow(period);
const repo = new AnonymousReviewRepository(), chain = new AnonymousReviewChain();
chain.check = async () => reviewConfig();
chain.active = async cohort => cohort.activationStatus === 'active_bridge';
const service = new AnonymousReviewService(repo, chain);
const graph = async (query: string, params: Record<string, any> = {}) => {
  const session = getDriver().session(); try { return await session.run(query, params); } finally { await session.close(); }
};
let checks = 0, initialized = false;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const denied = async (action: () => Promise<unknown>, message: string) => { let rejected = false; try { await action(); } catch { rejected = true; } check(rejected, message); };
try {
  await initDriver('bolt://127.0.0.1:7798', '', '', 1); initialized = true;
  check(Number((await graph('MATCH(n) RETURN count(n) AS total')).records[0]!.get('total')) === 0, 'Refuse nonempty databases.');
  await graph('CREATE (:User {id:$tutor})', { tutor: id('tutor') });
  for (let i = 0; i < 5; i++) await graph('CREATE (:Student {id:$id})', { id: id(`student-${i}`) });
  const book = async (name: string, student = 0, status = 'completed') => graph(`MATCH(s:Student {id:$student})
    CREATE (:Booking {bookingId:$booking,tutorId:$tutor,slotDateTime:datetime($start),durationMinutes:25,
      status:$status,attendanceStudent:'present',attendanceTutor:'present'})-[:BOOKED_BY]->(s)`,
  { student: id(`student-${student}`), booking: id(name), tutor: id('tutor'), start, status });
  const firstKeys = Array.from({ length: 7 }, () => new Identity().commitment.toString());
  for (let i = 0; i < 5; i++) {
    await book(`lesson-${i}`);
    await service.enroll(id(`lesson-${i}`), id('student-0'), firstKeys[i]!);
  }
  const a = await service.forLesson(id('lesson-0'), id('student-0')), b = await service.forLesson(id('lesson-1'), id('student-0'));
  check(a.enrolled && b.enrolled && a.groupId === b.groupId && a.entitlementId !== b.entitlementId, 'One student gets distinct entitlements for different lessons in the same group.');
  await service.enroll(id('lesson-0'), id('student-0'), firstKeys[0]!);
  check(await repo.memberCount(a.groupId) === 5, 'Retry does not issue a second lesson entitlement.');
  await denied(() => service.enroll(id('lesson-0'), id('student-0'), firstKeys[5]!), 'Cannot replace enrolled lesson key.');
  await denied(() => service.forLesson(id('lesson-0'), id('student-1')), 'Cannot enroll another student\'s lesson.');
  await book('duplicate-key');
  await denied(() => service.enroll(id('duplicate-key'), id('student-0'), firstKeys[0]!), 'Cannot reuse a review key for another lesson in the same cohort.');
  await book('unfinished', 0, 'confirmed');
  await denied(() => service.enroll(id('unfinished'), id('student-0'), firstKeys[5]!), 'An unfinished lesson does not create eligibility.');
  const cohort = (await repo.cohort(a.groupId))!;
  Date.now = () => Date.parse(window.opensAt) + 1000;
  check((await service.group(a.groupId)).state === 'insufficient_members', 'Five lessons from one student are not five distinct eligible students.');
  await denied(() => service.activate(a.groupId), 'Cannot seal a one-student batch.');
  Date.now = originalNow;
  for (let i = 1; i < 5; i++) { await book(`other-${i}`, i); await service.enroll(id(`other-${i}`), id(`student-${i}`), new Identity().commitment.toString()); }
  check(await repo.distinctStudentCount(a.groupId) === 5, 'Distinct-student privacy threshold counts students, not lessons.');
  await book('concurrent');
  await Promise.all(Array.from({ length: 6 }, () => service.enroll(id('concurrent'), id('student-0'), firstKeys[5]!)));
  check(await repo.memberCount(a.groupId) === 10, 'Concurrent retries create one enrollment per lesson.');
  const mine = await service.mine(id('student-0'));
  check(mine.length === 6 && new Set(mine.map(e => e.entitlementId)).size === 6, 'Private feedback list contains all six lesson entitlements.');
  check((await service.mine(id('student-1'))).length === 1, 'Private feedback list is account-scoped.');
  await denied(() => repo.enroll({ ...cohort, id: '0x' + 'e'.repeat(64), chainId: 42161 }, 'different-entitlement', id('student-0'), firstKeys[6]!, id('lesson-0')), 'Changing chain cannot create a second entitlement for the same lesson.');
  await book('status-race');
  const stale = await service.forLesson(id('status-race'), id('student-0'));
  await graph("MATCH(b:Booking {bookingId:$booking}) SET b.status='cancelled'", { booking: id('status-race') });
  await denied(() => repo.enroll(cohort, stale.entitlementId!, id('student-0'), firstKeys[6]!, id('status-race')), 'Repository rechecks eligibility inside the enrollment transaction.');
  Date.now = () => Date.parse(window.opensAt) + 1000;
  await service.activate(a.groupId);
  const publicGroup = await service.group(a.groupId);
  check(publicGroup.state === 'open' && publicGroup.members.length === 10, 'Frozen tutor group includes all lesson keys and remains usable.');
  const serialized = JSON.stringify(publicGroup);
  check(!serialized.includes(id('student-0')) && !serialized.includes(id('lesson-0')) && !serialized.includes(a.entitlementId!), 'Public group contains no private student/booking/entitlement IDs.');
  Date.now = originalNow;
  const legacyGroup = { ...cohort, id: reviewGroupId(id('legacy-tutor'), period, cohort.chainId), tutorId: id('legacy-tutor'), enrollmentPolicy: undefined };
  legacyGroup.scope = reviewScope(legacyGroup.chainId, legacyGroup.contract, legacyGroup.id);
  await graph(`MATCH(s:Student {id:$student}) CREATE (:Booking {bookingId:$booking,tutorId:$tutor,slotDateTime:datetime($start),
    durationMinutes:25,status:'completed',attendanceStudent:'present',attendanceTutor:'present'})-[:BOOKED_BY]->(s)`,
  { student: id('student-0'), booking: id('legacy-lesson'), tutor: legacyGroup.tutorId, start });
  await repo.enroll(legacyGroup, id('legacy-enrollment'), id('student-0'), firstKeys[6]!);
  const legacy = await service.forLesson(id('legacy-lesson'), id('student-0'));
  check(legacy.enrolled && legacy.enrollmentPolicy === 'per_student_month' && !legacy.entitlementId, 'Historical monthly enrollments remain historical and use their original key.');
  check((await repo.cohort(legacyGroup.id))?.enrollmentPolicy === undefined, 'No historical cohort is relabeled per-lesson.');
  console.log(`PASS ${checks} disposable per-lesson enrollment/privacy checks; chain operations mocked.`);
} finally {
  Date.now = originalNow;
  if (initialized) {
    // This test owns the empty disposable graph, including hashed cohort IDs.
    await graph('MATCH(n) DETACH DELETE n');
    await closeDriver();
  }
}
