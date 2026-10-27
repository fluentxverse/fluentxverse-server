import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { concat, keccak256, sha256, toHex, type Address, type Hex } from 'viem';
import { unpackGroth16Proof } from '@zk-kit/utils/proof-packing';
import { assertHorizenReceiptConfig, horizenVerificationNetwork, privacyInfrastructure } from '../proof.services/horizenReceipt';
import { REVIEW_DEPTH, REVIEW_PROTOCOL, reviewMessageJson, reviewScopeJson, validateAnonymousContent,
  type AnonymousReviewProof } from '../../shared/anonymousReviews';

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export class AnonymousReviewError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function requireAnonymousReviews() {
  if (process.env.ANONYMOUS_REVIEWS_ENABLED !== 'true') throw new AnonymousReviewError('Anonymous review pilot is disabled', 503);
}
export function reviewGroupId(tutorId: string, period: string) {
  privacyInfrastructure();
  const protocol = `${REVIEW_PROTOCOL}.bridge-only`;
  const chainId = Number(process.env.ANONYMOUS_REVIEWS_CHAIN_ID || '8453');
  if (chainId !== 2651420) {
    return keccak256(toHex(JSON.stringify({ protocol, tutorId, period, chainId })));
  }
  return keccak256(toHex(JSON.stringify({ protocol, tutorId, period })));
}
export function reviewScope(chainId: number, contract: string, groupId: string) {
  return (BigInt(keccak256(toHex(reviewScopeJson(chainId, contract, groupId)))) >> 8n).toString();
}
export function reviewMessage(groupId: string, content: unknown) {
  return BigInt(keccak256(toHex(reviewMessageJson(groupId, validateAnonymousContent(content))))).toString();
}
export function semaphoreHash(value: string): string {
  return (BigInt(keccak256(toHex(BigInt(value), { size: 32 }))) >> 8n).toString();
}
export function canonicalInteger(value: unknown, limit = FIELD, nonzero = false): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)
    || BigInt(value) >= limit || (nonzero && BigInt(value) === 0n)) throw new AnonymousReviewError('Invalid proof scalar');
  return value;
}
export function parseReviewProof(input: unknown): AnonymousReviewProof {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AnonymousReviewError('Invalid review proof');
  const p = input as Record<string, any>;
  if (Object.keys(p).some(key => !['merkleTreeDepth', 'merkleTreeRoot', 'nullifier', 'message', 'scope', 'points'].includes(key))
    || p.merkleTreeDepth !== REVIEW_DEPTH || !Array.isArray(p.points) || p.points.length !== 8) throw new AnonymousReviewError('Invalid review proof');
  return { merkleTreeDepth: REVIEW_DEPTH, merkleTreeRoot: canonicalInteger(p.merkleTreeRoot, FIELD, true),
    nullifier: canonicalInteger(p.nullifier, FIELD, true), message: canonicalInteger(p.message, 1n << 256n),
    scope: canonicalInteger(p.scope, 1n << 256n), points: p.points.map((point: unknown) => canonicalInteger(point, BASE_FIELD)) as AnonymousReviewProof['points'] };
}
export function reviewPublicSignals(proof: AnonymousReviewProof) {
  return [proof.merkleTreeRoot, proof.nullifier, semaphoreHash(proof.message), semaphoreHash(proof.scope)];
}
export function reviewStatement(vkHash: Hex, proof: AnonymousReviewProof): Hex {
  return reviewSignalStatement(vkHash, reviewPublicSignals(proof));
}
export function reviewSignalStatement(vkHash: Hex, signals: string[]): Hex {
  if (signals.length !== 4) throw new AnonymousReviewError('Invalid review public inputs');
  const encoded = signals.map(value =>
    `0x${BigInt(canonicalInteger(value)).toString(16).padStart(64, '0').match(/../g)!.reverse().join('')}` as Hex);
  return keccak256(concat([keccak256(toHex('groth16')), vkHash, sha256(toHex('')), keccak256(concat(encoded))]));
}
let activeVerifications = 0;
export async function verifyReviewProof(proof: AnonymousReviewProof): Promise<boolean> {
  reviewVerificationKey();
  if (activeVerifications >= 2) throw new AnonymousReviewError('Review verifier is busy; try again later', 503);
  activeVerifications++;
  try {
    // Like the existing snarkjs proving service, isolate Node crypto workers from Bun.
    return await new Promise((resolve, reject) => {
      const child = execFile('node', [fileURLToPath(new URL('./verify.mjs', import.meta.url))], { timeout: 30_000, maxBuffer: 2048 }, (error, stdout) => {
        if (error) reject(new AnonymousReviewError('Local review verification unavailable', 503));
        else resolve(stdout.trim() === 'true');
      });
      child.stdin?.on('error', () => {});
      child.stdin?.end(JSON.stringify(proof));
    });
  } finally { activeVerifications--; }
}
export function reviewGroth16(proof: AnonymousReviewProof) { return unpackGroth16Proof(proof.points); }

export function reviewConfig() {
  const chainId = Number(process.env.ANONYMOUS_REVIEWS_CHAIN_ID || '8453');
  const network = horizenVerificationNetwork(chainId);
  const address = (name: string): Address => {
    const value = process.env[name] || '';
    if (!/^0x[a-fA-F0-9]{40}$/.test(value) || BigInt(value) === 0n) throw new AnonymousReviewError('Review trust configuration is incomplete', 503);
    return value as Address;
  };
  const pin = (name: string) => {
    const value = process.env[name] || '';
    if (!/^[a-f0-9]{64}$/.test(value)) throw new AnonymousReviewError('Review artifact pins are missing', 503);
    return value;
  };
  const vkHash = process.env.ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH || '';
  const domainId = Number(process.env.ANONYMOUS_REVIEWS_DOMAIN_ID || '0');
  const rpcUrl = process.env.ANONYMOUS_REVIEWS_RPC_URL || '';
  if (!/^0x[a-fA-F0-9]{64}$/.test(vkHash) || BigInt(vkHash) === 0n || !Number.isSafeInteger(domainId) || domainId <= 0
    || !/^https?:\/\//.test(rpcUrl)) throw new AnonymousReviewError('Review chain configuration is incomplete', 503);
  const infrastructure = privacyInfrastructure(), bridge = address('ANONYMOUS_REVIEWS_BRIDGE');
  assertHorizenReceiptConfig({ chainId, bridge, domainId, rpcUrl });
  return { infrastructure, network, chainId, contract: bridge, bridge,
    vkHash: vkHash as Hex, domainId, rpcUrl, depth: REVIEW_DEPTH,
    artifacts: { wasmUrl: '/anonymous-reviews/semaphore.wasm', zkeyUrl: '/anonymous-reviews/semaphore.zkey',
      wasmSha256: pin('ANONYMOUS_REVIEWS_WASM_SHA256'), zkeySha256: pin('ANONYMOUS_REVIEWS_ZKEY_SHA256') } };
}

// Use the same fixed-depth key as Semaphore's local verifier, never a caller's key.
export function reviewVerificationKey() {
  const file = new URL('../src/verification-keys.json', import.meta.resolve('@semaphore-protocol/proof'));
  const keys = JSON.parse(readFileSync(file, 'utf8'));
  const vk = { ...keys, vk_delta_2: keys.vk_delta_2[REVIEW_DEPTH - 1], IC: keys.IC[REVIEW_DEPTH - 1] };
  const hash = createHash('sha256').update(JSON.stringify(vk)).digest('hex');
  if (hash !== process.env.ANONYMOUS_REVIEWS_VK_SHA256) throw new AnonymousReviewError('Unapproved Semaphore verification key', 503);
  return vk;
}
