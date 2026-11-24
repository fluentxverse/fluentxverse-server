import { describe, expect, test } from 'bun:test';
import { assertIdentityBinding, assertIdentityEligibility, assertIdentitySignals, signIdentityCredential,
  type IdentityEligibility } from '../src/services/tutorIdentity/credential';

export const eligibleIdentity = (): IdentityEligibility => ({ submissionId: 'submission', currentSubmissionId: 'submission',
  interviewId: 'interview', currentInterviewId: 'interview', status: 'verified', adultConfirmed: true, interviewResult: 'pass',
  interviewPassed: true, identityVerified: true, banned: false, revoked: false, walletPublicationConsent: true, walletBound: true });
export const mockBinding = { chainId: 421614 as const, collection: '0x' + '1'.repeat(40), holder: '0x' + '2'.repeat(40), mock: true };
describe('identity attestation', () => {
  test('requires all eligibility facts, current submission and current interview', () => {
    expect(() => assertIdentityEligibility(eligibleIdentity())).not.toThrow();
    const bad: Partial<IdentityEligibility>[] = [{ status: 'booked' }, { adultConfirmed: false }, { interviewPassed: false },
      { interviewResult: 'fail' }, { identityVerified: false }, { banned: true }, { revoked: true },
      { walletPublicationConsent: false }, { walletBound: false }, { currentSubmissionId: 'new' }, { currentInterviewId: 'new' }];
    for (const change of bad) expect(() => assertIdentityEligibility({ ...eligibleIdentity(), ...change })).toThrow();
  });
  test('never issues mock credentials on mainnet', () => {
    expect(() => assertIdentityBinding({ ...mockBinding, chainId: 42161 })).toThrow();
    expect(() => assertIdentityBinding({ ...mockBinding, holder: '0x' + '0'.repeat(40) })).toThrow();
  });
  test('pins issuer, wallet, collection, chain, policy, mock flag and issuance time', async () => {
    const result = await signIdentityCredential(eligibleIdentity(), mockBinding, Buffer.alloc(32, 13), 1700000000);
    expect(assertIdentitySignals(result.publicSignals, mockBinding, result.issuer, 1700000000)).toEqual(result.publicSignals);
    for (let i = 0; i < result.publicSignals.length; i++) {
      const bad = [...result.publicSignals]; bad[i] = i === 7 ? '0' : (BigInt(bad[i]!) + 1n).toString();
      expect(() => assertIdentitySignals(bad, mockBinding, result.issuer, 1700000000)).toThrow();
    }
    expect(() => assertIdentitySignals(result.publicSignals, { ...mockBinding, holder: mockBinding.collection }, result.issuer, 1700000000)).toThrow();
    expect(() => assertIdentitySignals(result.publicSignals, mockBinding, { ...result.issuer, issuerAx: '1' }, 1700000000)).toThrow();
    expect(JSON.stringify(result.input)).not.toContain('submission');
  });
});
