import { expect, test } from 'bun:test';
import { payoutEnginePolicy, payoutObservation, payoutReconciliationRequest, TutorPayoutRecoveryService, type PayoutIntent } from '../src/services/admin.services/tutorPayoutRecovery.service';

const policy = { chainId: 2651420 as const, verificationNetwork: 'Volta' as const,
  releaseManifestSHA256: 'a'.repeat(64), settlementPolicySHA256: 'b'.repeat(64) };
const intent: PayoutIntent = { protocol: 'fluentxverse.payout-intent.v1', operationId: 'payout-fixture', batchId: 'fixture',
  submissionKey: 'fxv-payout:fixture', tutorId: 'tutor-fixture', recipient: `0x${'1'.repeat(40)}`,
  currency: 'USD', totalCents: 1234, reservationExpiresAt: '2099-01-01T00:00:00.000Z', earnings: [], policy };
const observation = { submissionKey: intent.submissionKey, intentHash: 'c'.repeat(64), status: 'settled' as const,
  engineTransactionId: 'engine-fixture', transactionHash: `0x${'d'.repeat(64)}`, chainId: policy.chainId,
  settlementEvidenceHash: `0x${'e'.repeat(64)}` };

test('payout execution requires explicit reviewed release, settlement and matching network pins', () => {
  expect(payoutEnginePolicy(policy)).toEqual(policy);
  expect(payoutEnginePolicy({ ...policy, chainId: 26514, verificationNetwork: 'zkVerify' }).chainId).toBe(26514);
  expect(payoutEnginePolicy({ ...policy, chainId: 8453, verificationNetwork: 'zkVerify' }).chainId).toBe(8453);
  expect(payoutEnginePolicy({ ...policy, chainId: 84532 }).chainId).toBe(84532);
  for (const patch of [{ releaseManifestSHA256: '' }, { settlementPolicySHA256: 'not-a-pin' }, { verificationNetwork: 'zkVerify' },
    { chainId: 8453 }, { chainId: 84532, verificationNetwork: 'zkVerify' }, { chainId: 26514 }, { chainId: 0 }]) expect(() => payoutEnginePolicy({ ...policy, ...patch } as any)).toThrow();
});
test('only exact bound outcomes with final settlement evidence can finalize a payout', () => {
  expect(payoutObservation(intent, observation.intentHash, observation)).toBe(observation);
  for (const patch of [{ submissionKey: 'another-batch' }, { intentHash: 'f'.repeat(64) }, { status: 'confirmed' },
    { engineTransactionId: '' }, { engineTransactionId: '../other-project' }, { transactionHash: undefined }, { transactionHash: 'bad' },
    { chainId: 26514 }, { chainId: undefined }, { settlementEvidenceHash: undefined }, { settlementEvidenceHash: 'bad' }]) {
    expect(() => payoutObservation(intent, observation.intentHash, { ...observation, ...patch } as any)).toThrow();
  }
  expect(payoutObservation(intent, observation.intentHash, { ...observation, status: 'pending', settlementEvidenceHash: undefined }).status).toBe('pending');
  expect(() => payoutObservation(intent, observation.intentHash, { ...observation, status: 'reverted', settlementEvidenceHash: undefined })).toThrow();
});
test('reconciliation never accepts caller-supplied payment outcomes', () => {
  expect(() => payoutReconciliationRequest({})).not.toThrow();
  for (const body of [null, undefined, [], '', 'settled', { status: 'settled' }, { transactionHash: 'anything' }, { engineTransactionId: 'fixture' }, { force: true }]) {
    expect(() => payoutReconciliationRequest(body)).toThrow();
  }
});
test('invalid cancellation bodies fail before accessing financial storage', async () => {
  const recovery = new TutorPayoutRecoveryService();
  const request = { requestId: crypto.randomUUID(), reason: 'Fixture cancellation' };
  for (const body of [null, undefined, [], '', { ...request, requestId: 'bad' }, { ...request, requestId: 12 },
    { ...request, reason: '' }, { ...request, force: true }, { requestId: request.requestId }, { reason: request.reason }]) {
    await expect(recovery.cancel('fixture', 'fixture', 'fixture', body)).rejects.toThrow();
  }
});
