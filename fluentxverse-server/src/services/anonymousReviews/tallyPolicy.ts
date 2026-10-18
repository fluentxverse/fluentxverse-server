import { concat, keccak256, sha256, toHex, type Hex } from 'viem';
import { REVIEW_TOPICS, REVIEW_MIN_BATCH, REVIEW_MAX_MEMBERS, type AnonymousReviewContent } from '../../shared/anonymousReviews';
import { AnonymousReviewError, FIELD, reviewSignalStatement } from './policy';
import { privacyInfrastructure } from '../proof.services/horizenReceipt';

export const TALLY_PROTOCOL = 'fluentxverse.review-tally.v1';
export const TALLY_WORDS = 31;
export interface AcceptedReview { nullifier: Hex; messageHash: Hex; statement: Hex }
export interface TallySnapshot {
  chainId: number; registry: string; groupId: Hex; scopeHash: Hex; root: Hex; reviewVk: Hex;
  closesAt: number; blockNumber: number; blockHash: Hex; blockTimestamp: number; accepted: AcceptedReview[];
}
export interface TallyTotals { total: number; ratingSum: number; distribution: number[]; positive: number[]; improvement: number[] }
export interface TallyWitness { snapshot: TallySnapshot; contents: AnonymousReviewContent[] }
export interface TallyProof { proof: Hex; publicSignals: Hex; vk: Hex; version: 'V2_3'; proofSystem: 'risc0'; localVerified: true }
export function parseTallyProof(input: unknown): TallyProof {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid tally proof');
  const p = input as Record<string, unknown>;
  if (Object.keys(p).some(k => !['proof', 'publicSignals', 'vk', 'version', 'proofSystem', 'localVerified'].includes(k))
    || p.version !== 'V2_3' || p.proofSystem !== 'risc0' || p.localVerified !== true
    || typeof p.proof !== 'string' || !/^0x(?:[a-f0-9]{2})+$/.test(p.proof) || p.proof.length > 3 * 1024 * 1024
    || typeof p.publicSignals !== 'string' || !/^0x[a-f0-9]{1984}$/.test(p.publicSignals)) fail('Invalid tally proof envelope');
  return { proof: p.proof as Hex, publicSignals: p.publicSignals as Hex, vk: bytes32(p.vk), version: 'V2_3', proofSystem: 'risc0', localVerified: true };
}

function fail(message: string): never { throw new AnonymousReviewError(message, 409); }
export function word(value: number | bigint): Hex {
  const n = BigInt(value);
  if (n < 0n || n >= 1n << 256n) fail('Invalid tally integer');
  return toHex(n, { size: 32 });
}
function bytes32(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x[a-f0-9]{64}$/.test(value)) fail('Invalid tally binding');
  return value as Hex;
}
function scalar(value: unknown, nonzero = true): Hex {
  const hex = bytes32(value);
  if (BigInt(hex) >= FIELD || (nonzero && BigInt(hex) === 0n)) fail('Invalid tally scalar');
  return hex;
}
export function tallyContext(snapshot: TallySnapshot): Hex[] {
  const s = snapshot;
  if (Object.keys(s).some(k => !['chainId', 'registry', 'groupId', 'scopeHash', 'root', 'reviewVk', 'closesAt',
    'blockNumber', 'blockHash', 'blockTimestamp', 'accepted'].includes(k))) fail('Unexpected tally snapshot fields');
  if (s.chainId !== 2651420 || !/^0x[a-f0-9]{40}$/.test(s.registry) || BigInt(s.registry) === 0n
    || ![s.closesAt, s.blockNumber, s.blockTimestamp].every(n => Number.isSafeInteger(n) && n > 0)
    || s.blockTimestamp < s.closesAt || !Array.isArray(s.accepted)
    || s.accepted.length < REVIEW_MIN_BATCH || s.accepted.length > REVIEW_MAX_MEMBERS) fail('Invalid closed tally snapshot');
  for (const hex of [s.groupId, s.reviewVk, s.blockHash]) if (BigInt(bytes32(hex)) === 0n) fail('Empty tally binding');
  return [keccak256(toHex(TALLY_PROTOCOL)), word(s.chainId), word(BigInt(s.registry)), bytes32(s.groupId), scalar(s.scopeHash),
    scalar(s.root), bytes32(s.reviewVk), word(s.closesAt), word(s.blockNumber), bytes32(s.blockHash), word(s.blockTimestamp)];
}
export function tallyManifestHash(snapshot: TallySnapshot): Hex {
  const words = [...tallyContext(snapshot), word(snapshot.accepted.length)];
  let previous = 0n;
  for (const item of snapshot.accepted) {
    if (Object.keys(item).some(k => !['nullifier', 'messageHash', 'statement'].includes(k))) fail('Unexpected acceptance fields');
    const nullifier = scalar(item.nullifier), message = scalar(item.messageHash, false), statement = bytes32(item.statement);
    if (BigInt(nullifier) <= previous) fail('Duplicate or unordered tally nullifier');
    previous = BigInt(nullifier);
    const expected = reviewSignalStatement(snapshot.reviewVk, [snapshot.root, nullifier, message, snapshot.scopeHash].map(v => BigInt(v).toString()));
    if (expected !== statement) fail('Tally acceptance statement differs');
    words.push(nullifier, message, statement);
  }
  return keccak256(concat(words));
}
export function tallyTotals(contents: AnonymousReviewContent[]): TallyTotals {
  return { total: contents.length, ratingSum: contents.reduce((sum, content) => sum + content.rating, 0),
    distribution: [1, 2, 3, 4, 5].map(rating => contents.filter(c => c.rating === rating).length),
    positive: REVIEW_TOPICS.map(t => contents.filter(c => c.positive.includes(t.id)).length),
    improvement: REVIEW_TOPICS.map(t => contents.filter(c => c.improvement.includes(t.id)).length) };
}
export function tallyJournal(snapshot: TallySnapshot, totals: TallyTotals): Hex {
  const t = totals;
  if (Object.keys(t).some(k => !['total', 'ratingSum', 'distribution', 'positive', 'improvement'].includes(k))) fail('Unexpected tally total fields');
  const validCount = (n: number) => Number.isInteger(n) && n >= 0 && n <= t.total;
  if (t.total !== snapshot.accepted.length || t.distribution.length !== 5 || t.positive.length !== 6 || t.improvement.length !== 6
    || ![...t.distribution, ...t.positive, ...t.improvement].every(validCount)
    || t.distribution.reduce((sum, n) => sum + n, 0) !== t.total
    || t.distribution.reduce((sum, n, i) => sum + n * (i + 1), 0) !== t.ratingSum
    || t.positive[5] !== 0 || t.positive.some((n, i) => n + t.improvement[i]! > t.total)) fail('Invalid tally totals');
  const words = [...tallyContext(snapshot), tallyManifestHash(snapshot), ...[t.total, t.ratingSum, ...t.distribution, ...t.positive, ...t.improvement].map(word)];
  if (words.length !== TALLY_WORDS) fail('Invalid tally journal');
  return concat(words);
}
export function tallySummary(t: TallyTotals) {
  return { total: t.total, average: Math.round(t.ratingSum / t.total * 10) / 10,
    distribution: t.distribution.map((count, i) => ({ rating: i + 1, count })),
    topics: REVIEW_TOPICS.map((topic, i) => ({ ...topic, positiveCount: t.positive[i]!, improvementCount: t.improvement[i]! })) };
}
export function tallyStatement(imageId: Hex, journal: Hex): Hex {
  if (!/^0x[a-f0-9]{1984}$/.test(journal)) fail('Invalid tally journal length');
  return keccak256(concat([keccak256(toHex('risc0')), bytes32(imageId), sha256(toHex('risc0:v2.3')), keccak256(journal)]));
}
export function tallyConfig() {
  if (process.env.ANONYMOUS_REVIEW_TALLY_ENABLED !== 'true') throw new AnonymousReviewError('Proof-backed tally pilot is disabled', 503);
  const imageId = process.env.ANONYMOUS_REVIEW_TALLY_IMAGE_ID as Hex;
  if (!/^0x[a-f0-9]{64}$/.test(imageId || '') || BigInt(imageId) === 0n) throw new AnonymousReviewError('Tally program is not approved', 503);
  const start = privacyInfrastructure() === 'bridge_only' ? 0 : Number(process.env.ANONYMOUS_REVIEWS_DEPLOYMENT_BLOCK);
  if (!Number.isSafeInteger(start) || start < 0 || (privacyInfrastructure() === 'legacy_contracts' && start === 0)) throw new AnonymousReviewError('Review deployment block is missing', 503);
  const maxReviews = Number(process.env.ANONYMOUS_REVIEW_TALLY_MAX_REVIEWS || '8');
  if (!Number.isSafeInteger(maxReviews) || maxReviews < 5 || maxReviews > 256) throw new AnonymousReviewError('Invalid tally capacity policy', 503);
  return { imageId, deploymentBlock: start, maxReviews };
}
