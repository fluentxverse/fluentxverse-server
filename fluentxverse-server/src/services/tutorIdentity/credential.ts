import { createHash, randomBytes } from 'node:crypto';
import { buildEddsa, buildPoseidon } from 'circomlibjs';

export const IDENTITY_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const identityPolicy = {
  type: 'fluentxverse.tutor-identity.v1', age: '18+', liveSameDocumentMatch: true,
  interviewPassRequired: true, expires: false, issuer: 'FluentXVerse staff attestation',
} as const;
export const identityPolicyHash = (BigInt('0x' + createHash('sha256').update(JSON.stringify(identityPolicy)).digest('hex')) % IDENTITY_FIELD).toString();
export const identitySignalNames = ['valid', 'policyHash', 'issuerAx', 'issuerAy', 'chainId', 'collection', 'holder', 'credentialCommitment', 'issuedAt', 'mock'] as const;
export interface IdentityBinding { chainId: 42161 | 421614; collection: string; holder: string; mock: boolean }
export interface IdentityEligibility {
  submissionId: string; currentSubmissionId: string; interviewId: string; currentInterviewId: string;
  status: string; adultConfirmed: boolean; interviewResult: string; interviewPassed: boolean;
  identityVerified: boolean; banned: boolean; revoked: boolean; walletPublicationConsent: boolean;
  walletBound: boolean;
}
export function assertIdentityEligibility(e: IdentityEligibility) {
  if (!e.submissionId || e.submissionId !== e.currentSubmissionId || !e.interviewId || e.interviewId !== e.currentInterviewId
    || e.status !== 'verified' || e.adultConfirmed !== true || e.interviewResult !== 'pass' || e.interviewPassed !== true
    || e.identityVerified !== true || e.banned !== false || e.revoked !== false || e.walletPublicationConsent !== true || e.walletBound !== true)
    throw Error('Identity credential is not eligible');
}
function address(value: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value) || BigInt(value) === 0n) throw Error('Invalid credential address');
  return BigInt(value).toString();
}
export function assertIdentityBinding(binding: IdentityBinding) {
  if (![42161, 421614].includes(binding.chainId) || typeof binding.mock !== 'boolean' || (binding.mock && binding.chainId !== 421614))
    throw Error('Mock credentials require Arbitrum Sepolia');
  address(binding.collection); address(binding.holder);
}
export async function signIdentityCredential(e: IdentityEligibility, binding: IdentityBinding, seed: Buffer, issuedAt = Math.floor(Date.now() / 1000)) {
  assertIdentityEligibility(e); assertIdentityBinding(binding);
  if (seed.length !== 32 || !Number.isSafeInteger(issuedAt) || issuedAt <= 0) throw Error('Invalid identity issuer or time');
  const poseidon = await buildPoseidon(), eddsa = await buildEddsa();
  const hash = (items: string[]) => poseidon.F.toObject(poseidon(items.map(BigInt))).toString();
  const [issuerAx, issuerAy] = eddsa.prv2pub(seed).map((x: any) => eddsa.F.toObject(x).toString());
  // Random secrets, not document hashes, birth dates, names or applicant identifiers.
  const secret = () => (BigInt('0x' + randomBytes(31).toString('hex')) + 1n).toString();
  const subjectSecret = secret(), evidenceSecret = secret();
  const input = { policyHash: identityPolicyHash, issuerAx, issuerAy, chainId: String(binding.chainId),
    collection: address(binding.collection), holder: address(binding.holder), credentialCommitment: '', issuedAt: String(issuedAt),
    mock: binding.mock ? '1' : '0', subjectSecret, evidenceSecret, adultConfirmed: '1', liveMatch: '1', interviewPassed: '1',
    signatureR8x: '', signatureR8y: '', signatureS: '' };
  input.credentialCommitment = hash([subjectSecret, evidenceSecret, input.policyHash, input.chainId, input.collection, input.holder, input.mock]);
  const message = hash([input.policyHash, input.chainId, input.collection, input.holder, input.credentialCommitment,
    input.issuedAt, input.mock, input.adultConfirmed, input.liveMatch, input.interviewPassed, evidenceSecret]);
  const signature = eddsa.signPoseidon(seed, eddsa.F.e(BigInt(message)));
  input.signatureR8x = eddsa.F.toObject(signature.R8[0]).toString();
  input.signatureR8y = eddsa.F.toObject(signature.R8[1]).toString();
  input.signatureS = signature.S.toString();
  return { input, publicSignals: identitySignalNames.map(n => n === 'valid' ? '1' : input[n]),
    issuer: { issuerAx, issuerAy } };
}
export function assertIdentitySignals(values: unknown, binding: IdentityBinding, issuer: { issuerAx: string; issuerAy: string }, now = Math.floor(Date.now() / 1000)) {
  assertIdentityBinding(binding);
  if (!Array.isArray(values) || values.length !== identitySignalNames.length || values.some(v => typeof v !== 'string' || !/^(0|[1-9][0-9]{0,76})$/.test(v) || BigInt(v) >= IDENTITY_FIELD))
    throw Error('Noncanonical identity signals');
  const expected = ['1', identityPolicyHash, issuer.issuerAx, issuer.issuerAy, String(binding.chainId), address(binding.collection), address(binding.holder)];
  if (expected.some((v, i) => values[i] !== v) || values[7] === '0' || BigInt(values[8]) <= 0n || BigInt(values[8]) > BigInt(now) || values[9] !== (binding.mock ? '1' : '0'))
    throw Error('Identity proof binding differs');
  return values as string[];
}
