import { afterEach, expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Group } from '@semaphore-protocol/group';
import { validateAnonymousContent, reviewMessageJson, reviewWindow, summarizeAnonymousReviews } from '../src/shared/anonymousReviews';
import { FIELD, parseReviewProof, reviewMessage, reviewPublicSignals, reviewScope, reviewVerificationKey, verifyReviewProof } from '../src/services/anonymousReviews/policy';
import { encryptReview, decryptReview } from '../src/services/anonymousReviews/storage';
import { AnonymousReviewRepository, type ReviewCohort } from '../src/services/anonymousReviews/repository';
import { AnonymousReviewChain } from '../src/services/anonymousReviews/chain';
import { AnonymousReviewService } from '../src/services/anonymousReviews/service';
import { lessonSurveyService } from '../src/services/lessonSurvey.service';

const savedEnv = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv); });
const content = { rating: 5, positive: ['feedback'], improvement: ['connection'], salt: 'ab'.repeat(32) };
function configure() {
  process.env.PRIVACY_INFRA_MODE = 'bridge_only';
  process.env.ANONYMOUS_REVIEWS_ENABLED = 'true';
  process.env.ANONYMOUS_REVIEWS_CONTRACT = `0x${'1'.repeat(40)}`;
  process.env.ANONYMOUS_REVIEWS_BRIDGE = '0x3098A6974649478f0133046e44105AA84e868C21';
  process.env.ANONYMOUS_REVIEWS_DOMAIN_ID = '175'; process.env.ANONYMOUS_REVIEWS_RPC_URL = 'http://127.0.0.1:1';
  process.env.ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH = `0x${'a'.repeat(64)}`;
  process.env.ANONYMOUS_REVIEWS_WASM_SHA256 = 'a'.repeat(64); process.env.ANONYMOUS_REVIEWS_ZKEY_SHA256 = 'b'.repeat(64);
  process.env.ANONYMOUS_REVIEWS_ENCRYPTION_KEY = '12'.repeat(32);
  const keys = JSON.parse(readFileSync(new URL('../src/verification-keys.json', import.meta.resolve('@semaphore-protocol/proof')), 'utf8'));
  const vk = { ...keys, vk_delta_2: keys.vk_delta_2[7], IC: keys.IC[7] };
  process.env.ANONYMOUS_REVIEWS_VK_SHA256 = createHash('sha256').update(JSON.stringify(vk)).digest('hex');
}

test('canonical structured content rejects identity fields, free text, duplicate and conflicting topics', () => {
  expect(validateAnonymousContent(content)).toEqual(content);
  for (const bad of [{ ...content, comment: 'Identifying text' }, { ...content, studentId: 'student' },
    { ...content, rating: 5.5 }, { ...content, salt: 'short' }, { ...content, positive: ['feedback', 'feedback'] },
    { ...content, improvement: ['feedback'] }, { ...content, positive: ['engagement'] }]) expect(() => validateAnonymousContent(bad)).toThrow();
  expect(reviewMessageJson('group', { ...content, positive: ['pace', 'feedback'] }))
    .toBe(reviewMessageJson('group', { ...content, positive: ['feedback', 'pace'] }));
  expect(reviewMessage('group', content)).not.toBe(reviewMessage('group', { ...content, salt: 'cd'.repeat(32) }));
});
test('UTC windows and deployment-separated scopes are deterministic', () => {
  expect(reviewWindow('2026-12')).toEqual({ opensAt: '2027-01-01T00:00:00.000Z', closesAt: '2027-01-08T00:00:00.000Z' });
  expect(() => reviewWindow('2026-13')).toThrow();
  expect(reviewScope(2651420, '0xABC', 'group')).toBe(reviewScope(2651420, '0xabc', 'group'));
  expect(reviewScope(2651420, '0xabc', 'group')).not.toBe(reviewScope(26514, '0xabc', 'group'));
});
test('browser and backend use the exact same generated policy; pilot cannot fall back to linked surveys', async () => {
  const source = readFileSync(new URL('../src/shared/anonymousReviews.ts', import.meta.url), 'utf8');
  const browser = readFileSync(new URL('../../fluentxverse-student-solid-prototype/student/shared/anonymousReviews.ts', import.meta.url), 'utf8');
  expect(browser).toBe('// Generated from fluentxverse-server/src/shared/anonymousReviews.ts.\n' + source);
  configure(); await expect(lessonSurveyService.submit('booking', 'student', {})).rejects.toThrow('identity-linked feedback is disabled');
});
test('encrypted feedback authenticates context; summaries do not expose salt or individual content', () => {
  configure(); const encrypted = encryptReview(content, 'review');
  expect(encrypted).not.toContain('feedback'); expect(decryptReview(encrypted, 'review')).toEqual(content);
  expect(() => decryptReview(encrypted, 'different-review')).toThrow();
  const summary = summarizeAnonymousReviews([content, { ...content, rating: 1 }]);
  expect(summary.average).toBe(3); expect(JSON.stringify(summary)).not.toContain(content.salt);
});
test.skipIf(!existsSync(new URL('../../fluentxverse-student-solid-prototype/public/anonymous-reviews/semaphore.zkey', import.meta.url)))(
  'actual Semaphore proof verifies; changed message, scope, nullifier and root do not', async () => {
  configure();
  const fixture = JSON.parse(execFileSync('node', [new URL('./fixtures/anonymousReviewProof.mjs', import.meta.url).pathname], { encoding: 'utf8', timeout: 120_000 }));
  const proof = parseReviewProof(fixture.proof);
  expect(reviewVerificationKey().nPublic).toBe(4);
  expect(reviewPublicSignals(proof)).toEqual(fixture.signals);
  expect(proof.message).toBe(reviewMessage(fixture.groupId, fixture.content));
  expect(await verifyReviewProof(proof)).toBe(true);
  for (const key of ['message', 'scope', 'nullifier', 'merkleTreeRoot'] as const) {
    const changed = { ...proof, [key]: (BigInt(proof[key]) + 1n).toString() };
    expect(await verifyReviewProof(changed)).toBe(false);
  }
  expect(() => parseReviewProof({ ...proof, nullifier: FIELD.toString() })).toThrow();
  expect(() => parseReviewProof({ ...proof, merkleTreeDepth: 9 })).toThrow();
}, 120_000);
test('enrollment requires owned, ended, completed attendance; immutable identity retries retain the entitlement', async () => {
  configure(); const repo = new AnonymousReviewRepository(), chain = new AnonymousReviewChain(), service = new AnonymousReviewService(repo, chain);
  const booking = { tutorId: 'tutor', slotDateTime: new Date(Date.now() - 3600_000).toISOString(), durationMinutes: 25,
    status: 'completed', attendanceStudent: 'present', attendanceTutor: 'present' };
  const owned = spyOn(repo, 'ownedBooking').mockResolvedValue({ booking, legacyReviewed: false });
  const enrollment = spyOn(repo, 'enrollment').mockResolvedValue(null);
  const save = spyOn(repo, 'enroll').mockResolvedValue(); const check = spyOn(chain, 'check').mockResolvedValue({} as any);
  try {
    expect((await service.forLesson('booking', 'student')).canEnroll).toBe(true);
    await service.enroll('booking', 'student', '123'); expect(save).toHaveBeenCalledTimes(1);
    for (const update of [{ status: 'cancelled' }, { attendanceStudent: 'absent' }, { attendanceTutor: 'absent' }, { status: 'confirmed' }]) {
      owned.mockResolvedValue({ booking: { ...booking, ...update }, legacyReviewed: false });
      expect((await service.forLesson('booking', 'student')).canEnroll).toBe(false);
      await expect(service.enroll('booking', 'student', '123')).rejects.toThrow('completed lesson');
    }
    owned.mockResolvedValue({ booking, legacyReviewed: true }); expect((await service.forLesson('booking', 'student')).canEnroll).toBe(false);
    enrollment.mockResolvedValue({ commitment: '123' }); expect((await service.forLesson('booking', 'student')).enrolled).toBe(true);
  } finally { owned.mockRestore(); enrollment.mockRestore(); save.mockRestore(); check.mockRestore(); }
});
test('batch publication is closed-window, thresholded, chain-confirmed and immutable', async () => {
  configure(); const repo = new AnonymousReviewRepository(), chain = new AnonymousReviewChain(), service = new AnonymousReviewService(repo, chain);
  const cohort = { id: 'group', period: '2020-01', tutorId: 'tutor', scope: '3', chainId: 2651420, contract: process.env.ANONYMOUS_REVIEWS_CONTRACT,
    opensAt: '2020-02-01T00:00:00Z', closesAt: '2020-02-08T00:00:00Z', root: '1', membersJson: '[]' } as ReviewCohort;
  const proof = { merkleTreeDepth: 8, merkleTreeRoot: '1', nullifier: '2', message: reviewMessage('group', content), scope: '3', points: Array(8).fill('0') };
  let items = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, groupId: 'group', nullifier: `${i + 1}`, status: 'awaiting_horizen',
    proofJson: JSON.stringify({ ...proof, nullifier: `${i + 1}` }), encryptedContent: encryptReview(content, `r${i}`) }));
  const get = spyOn(repo, 'cohort').mockImplementation(async () => cohort);
  const list = spyOn(repo, 'submissions').mockImplementation(async () => items);
  const active = spyOn(chain, 'active').mockResolvedValue(true), accepted = spyOn(chain, 'accepted').mockResolvedValue(true);
  const save = spyOn(repo, 'saveSummary').mockImplementation(async (_id, value) => { cohort.summaryJson = value; return cohort; });
  try {
    cohort.closesAt = new Date(Date.now() + 3600_000).toISOString(); await expect(service.publish('group')).rejects.toThrow('window closes');
    cohort.closesAt = '2020-02-08T00:00:00Z'; items = items.slice(0, 4); await expect(service.publish('group')).rejects.toThrow('five chain-accepted');
    items.push({ ...items[0]!, id: 'r4', nullifier: '5', proofJson: JSON.stringify({ ...proof, nullifier: '5' }), encryptedContent: encryptReview(content, 'r4') });
    accepted.mockResolvedValue(false); await expect(service.publish('group')).rejects.toThrow('five chain-accepted');
    accepted.mockResolvedValue(true); const result = await service.publish('group'); expect(result.total).toBe(5);
    await service.publish('group'); expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('encryptedContent'); expect(JSON.stringify(result)).not.toContain(content.salt);
  } finally { get.mockRestore(); list.mockRestore(); active.mockRestore(); accepted.mockRestore(); save.mockRestore(); }
});
test('a closed enrollment cohort below the privacy threshold exposes neither members nor a count', async () => {
  configure(); const repo = new AnonymousReviewRepository(), service = new AnonymousReviewService(repo);
  const get = spyOn(repo, 'cohort').mockResolvedValue({ id: 'group', tutorId: 'tutor', period: '2026-10', scope: '3', chainId: 2651420,
    contract: process.env.ANONYMOUS_REVIEWS_CONTRACT!, opensAt: new Date(Date.now() - 3600_000).toISOString(), closesAt: new Date(Date.now() + 3600_000).toISOString() });
  const count = spyOn(repo, 'memberCount').mockResolvedValue(4);
  try {
    const result = await service.group('group'); expect(result.state).toBe('insufficient_members'); expect(result.members).toEqual([]);
    expect('memberCount' in result).toBe(false);
  } finally { get.mockRestore(); count.mockRestore(); }
});
