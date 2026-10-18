import { randomBytes } from 'node:crypto';
import { buildEddsa, buildPoseidon } from 'circomlibjs';
import { assertScreeningEvidence, type ScreeningEvidence } from './evidence';
import { decodeScreeningSignals, fieldHash, policyHash, schemaHash, screeningPolicy, publicSignalNames, type ScreeningSignals } from './policy';

export interface ScreeningBinding { chainId: number; agentId: string; adapterAddress: string }
const messageNames = ['credentialCommitment', 'policyHash', 'schemaHash', 'issuerHash', 'evidenceRoot', 'attemptHash', 'issuedAt', 'expiresAt', 'chainId', 'agentId', 'adapterAddress'] as const;

export async function signScreeningCredential(evidence: ScreeningEvidence, binding: ScreeningBinding, issuerSeed: Buffer, now = Math.floor(Date.now() / 1000)) {
  assertScreeningEvidence(evidence);
  if (issuerSeed.length !== 32) throw new Error('Dedicated 32-byte screening issuer key required');
  if (!Number.isSafeInteger(binding.chainId) || binding.chainId <= 0 || !/^\d+$/.test(binding.agentId) || BigInt(binding.agentId) >= 2n ** 64n
    || !/^0x[a-fA-F0-9]{40}$/.test(binding.adapterAddress) || BigInt(binding.adapterAddress) === 0n) throw new Error('Invalid agent/chain/validator binding');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid issuance time');
  for (const date of [evidence.written.completedAt, evidence.speaking.completedAt, evidence.profile.reviewedAt, evidence.interview.completedAt]) {
    if (Date.parse(date) > now * 1000) throw new Error('Evidence cannot be completed in the future');
  }
  const poseidon = await buildPoseidon();
  const eddsa = await buildEddsa();
  const hash = (values: string[]) => poseidon.F.toObject(poseidon(values.map(BigInt))).toString();
  const pubkey = eddsa.prv2pub(issuerSeed).map((point: any) => eddsa.F.toObject(point).toString());
  const nonce = (BigInt(`0x${randomBytes(31).toString('hex')}`) + 1n).toString();
  const subjectHash = fieldHash({ tutorId: evidence.tutorId });
  const attemptHash = fieldHash({ nonce, written: evidence.written.attemptId, speaking: evidence.speaking.attemptId, interview: evidence.interview.attemptId });
  const signals: ScreeningSignals = {
    valid: '1', credentialCommitment: hash([subjectHash, nonce, policyHash, attemptHash]),
    policyHash, schemaHash, issuerAx: pubkey[0], issuerAy: pubkey[1], issuerHash: hash(pubkey),
    evidenceRoot: fieldHash({ evidence, nonce }), attemptHash, issuedAt: String(now), expiresAt: String(now + screeningPolicy.validitySeconds),
    chainId: String(binding.chainId), agentId: BigInt(binding.agentId).toString(), adapterAddress: BigInt(binding.adapterAddress).toString(), subjectHash,
  };
  const message = hash([String(evidence.written.score), String(evidence.speaking.score), '1', '1', ...messageNames.map(name => signals[name])]);
  const signature = eddsa.signPoseidon(issuerSeed, eddsa.F.e(BigInt(message)));
  const { valid: _, ...publicInputs } = signals;
  const input = { writtenScore: String(evidence.written.score), speakingScore: String(evidence.speaking.score), profileApproved: '1', interviewPassed: '1',
    credentialNonce: nonce, ...publicInputs,
    signatureR8x: eddsa.F.toObject(signature.R8[0]).toString(), signatureR8y: eddsa.F.toObject(signature.R8[1]).toString(), signatureS: signature.S.toString() };
  return { input, signals, publicSignals: publicSignalNames.map(name => signals[name]) };
}

export function assertCredentialCurrent(values: unknown, binding: ScreeningBinding, trustedIssuerHash: string, now = Math.floor(Date.now() / 1000)) {
  const signals = decodeScreeningSignals(values);
  if (signals.issuerHash !== trustedIssuerHash || signals.chainId !== String(binding.chainId) || signals.agentId !== BigInt(binding.agentId).toString()
    || signals.adapterAddress !== BigInt(binding.adapterAddress).toString()) throw new Error('Unapproved issuer or mismatched validation destination');
  if (BigInt(signals.issuedAt) > BigInt(now) || BigInt(signals.expiresAt) <= BigInt(now)
    || BigInt(signals.expiresAt) - BigInt(signals.issuedAt) !== BigInt(screeningPolicy.validitySeconds)) throw new Error('Expired or invalid credential lifetime');
  return signals;
}
