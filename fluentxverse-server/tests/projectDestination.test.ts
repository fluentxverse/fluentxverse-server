import { afterEach, expect, spyOn, test } from 'bun:test';
import { fixtureFetch } from './fixtureFetch';
import { createHash } from 'node:crypto';
import { engineReceiptDestination, mainnetReceiptCoordinates } from '../src/services/proof.services/projectDestination';
import { MAINNET_RECEIPT_DESTINATIONS } from '../src/services/proof.services/horizenReceipt';
import { currentReviewConfig, reviewConfig, reviewGroupId } from '../src/services/anonymousReviews/policy';
import { validatePayoutProofRelease } from '../src/services/admin.services/tutorPayoutAuthorization.service';
import { AnonymousReviewRepository } from '../src/services/anonymousReviews/repository';
import { AnonymousReviewService } from '../src/services/anonymousReviews/service';

const saved = { ...process.env };
afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); });
function environment() {
  Object.assign(process.env, { PROOF_DESTINATION_MODE: 'project', PRIVACY_INFRA_MODE: 'bridge_only',
    GMR_ANONYMOUS_REVIEWS_ENGINE_API_BASE: 'https://engine.fixture.invalid', GMR_ANONYMOUS_REVIEWS_ENGINE_API_KEY: 'synthetic',
    ANONYMOUS_REVIEWS_CHAIN_ID: '42161', ANONYMOUS_REVIEWS_DOMAIN_ID: '10',
    ANONYMOUS_REVIEWS_BRIDGE: MAINNET_RECEIPT_DESTINATIONS[1]!.bridge,
    ANONYMOUS_REVIEWS_RPC_URL: 'https://arb1.arbitrum.io/rpc', ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH: '0x'+'ab'.repeat(32),
    ANONYMOUS_REVIEWS_WASM_SHA256: 'ab'.repeat(32), ANONYMOUS_REVIEWS_ZKEY_SHA256: 'cd'.repeat(32) });
}
test('new review cohorts follow every project destination without changing historical coordinates', async () => {
  environment();
  let destination: any = MAINNET_RECEIPT_DESTINATIONS[0];
  const mock = spyOn(globalThis, 'fetch').mockImplementation(fixtureFetch(async () => Response.json({ destination })));
  try {
    for (const d of MAINNET_RECEIPT_DESTINATIONS) {
      destination = d;
      const current = await currentReviewConfig();
      expect(current.chainId).toBe(d.chainId); expect(current.domainId).toBe(d.domainId); expect(current.bridge).toBe(d.bridge);
      expect(reviewConfig(42161).chainId).toBe(42161); expect(reviewConfig(42161).domainId).toBe(10);
      if (d.chainId !== 42161) expect(reviewGroupId('tutor', '2026-10', d.chainId)).not.toBe(reviewGroupId('tutor', '2026-10', 42161));
    }
    for (const bad of [{ chainId: 999 }, { ...destination, domainId: 999 }, { ...destination, bridge: '0x'+'1'.repeat(40) }]) {
      destination = bad; await expect(engineReceiptDestination('GMR_ANONYMOUS_REVIEWS')).rejects.toThrow();
    }
    mock.mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 503 }));
    await expect(currentReviewConfig()).rejects.toThrow('unavailable');
    mock.mockResolvedValueOnce(new Response('x'.repeat(17000)));
    await expect(currentReviewConfig()).rejects.toThrow('exceeds limit');
    process.env.PROOF_DESTINATION_MODE = 'fixed';
    expect((await currentReviewConfig()).chainId).toBe(42161);
  } finally { mock.mockRestore(); }
});
test('payout routing is selectable but issuer, setup, scope and financial policy pins remain mandatory', () => {
  environment();
  const policyHash = String(BigInt('0x'+createHash('sha256').update('fluentxverse.payout-authorization.v2:fluentxverse.usd-earnings.v1.zero-fee').digest('hex')) % 21888242871839275222246405745257275088548364400416034343698204186575808495617n);
  Object.assign(process.env, { PAYOUT_ARTIFACTS_APPROVED: 'true', PAYOUT_VERIFICATION_NETWORK: 'zkVerify', PAYOUT_CHAIN_ID: '42161', PAYOUT_ZKVERIFY_DOMAIN_ID: '10',
    PAYOUT_RELEASE_MANIFEST_SHA256: 'a'.repeat(64), PAYOUT_ZKVERIFY_VK_HASH: '0x'+'b'.repeat(64), PAYOUT_ISSUER_HASH: '4', PAYOUT_SCOPE_HASH: '7' });
  for (const destination of MAINNET_RECEIPT_DESTINATIONS) {
    const r: any = { ...destination, verificationNetwork: 'zkVerify', cryptographicSetupVerified: true,
      releaseManifestSHA256: 'a'.repeat(64), vkHash: '0x'+'b'.repeat(64), policyHash, issuerHash: '4', issuerAx: '5', issuerAy: '6', scopeHash: '7',
      releasePolicy: 'independent-reviewed', independentlyReviewed: true, independentContributors: true,
      vk: { protocol: 'groth16', curve: 'bn128', nPublic: 20, IC: Array(21).fill(['1','2','1']),
        vk_gamma_2: [['1','2'],['3','4'],['1','0']], vk_delta_2: [['5','6'],['7','8'],['1','0']] } };
    expect(validatePayoutProofRelease(r).chainId).toBe(destination.chainId);
    for (const patch of [{ issuerHash: '99' }, { scopeHash: '99' }, { policyHash: '99' }, { releaseManifestSHA256: 'c'.repeat(64) }, { domainId: 999 }, { bridge: '0x'+'1'.repeat(40) }])
      expect(() => validatePayoutProofRelease({ ...r, ...patch })).toThrow();
  }
  expect(() => mainnetReceiptCoordinates(26514)).toThrow();
});
test('changing destinations cannot give an enrolled student another monthly review entitlement', async () => {
  environment(); process.env.ANONYMOUS_REVIEWS_ENABLED = 'true';
  const repo = new AnonymousReviewRepository(), service = new AnonymousReviewService(repo);
  const original: any = { id: 'original-group', tutorId: 'tutor', period: '2026-10', chainId: 42161,
    scope: 'original', contract: MAINNET_RECEIPT_DESTINATIONS[1]!.bridge, opensAt: '2026-11-01T00:00:00Z', closesAt: '2026-11-08T00:00:00Z' };
  const mocks = [
    spyOn(globalThis, 'fetch').mockImplementation(fixtureFetch(async () => Response.json({ destination: MAINNET_RECEIPT_DESTINATIONS[2] }))),
    spyOn(repo, 'ownedBooking').mockResolvedValue({ booking: { tutorId: 'tutor', slotDateTime: '2026-10-01T12:00:00Z', status: 'completed', attendanceStudent: 'present', attendanceTutor: 'present' }, legacyReviewed: false }),
    spyOn(repo, 'legacyEnrollmentForPeriod').mockResolvedValue({ enrollment: { id: 'old-enrollment', groupId: original.id, commitment: '123' }, cohort: original }),
    spyOn(repo, 'enrollment').mockResolvedValue({ id: 'old-enrollment', groupId: original.id, commitment: '123' }),
    spyOn(repo, 'enrollmentForLesson').mockResolvedValue(null),
  ];
  try {
    const enrollment = await service.forLesson('lesson', 'student');
    expect(enrollment.groupId).toBe(original.id); expect(enrollment.enrolled).toBe(true); expect(enrollment.canEnroll).toBe(false);
    expect(mocks[2]).toHaveBeenCalledWith('tutor', '2026-10', 'student');
  } finally { for (const mock of mocks) mock.mockRestore(); }
});
