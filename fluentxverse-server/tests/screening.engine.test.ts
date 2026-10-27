import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { approvedScreeningArtifacts, proveScreeningCredential } from '../src/services/screening/prover';
import { policyHash, schemaHash, publicSignalNames } from '../src/services/screening/policy';
import { HORIZEN_TESTNET_BRIDGE, horizenReceiptReader } from '../src/services/proof.services/horizenReceipt';
import { submitBridgeScreeningProof } from '../src/services/screening/chain';

const savedEnv = { ...process.env };
const gamma = [['1', '2'], ['3', '4'], ['1', '0']], delta = [['5', '6'], ['7', '8'], ['1', '0']];
const release = () => ({ releaseManifestSHA256: 'a'.repeat(64), vkHash: '0x' + 'b'.repeat(64), policyHash, schemaHash,
  issuerHash: '4', issuerAx: '5', issuerAy: '6', chainId: 2651420, domainId: 175, bridge: HORIZEN_TESTNET_BRIDGE,
  agentId: '0', verificationNetwork: 'Volta', cryptographicSetupVerified: true,
  vk: { protocol: 'groth16', curve: 'bn128', nPublic: 15, IC: Array(16).fill(['1', '2', '1']), vk_gamma_2: gamma, vk_delta_2: delta } });
let fetchMock: ReturnType<typeof spyOn>;
beforeEach(() => {
  Object.assign(process.env, { PRIVACY_INFRA_MODE: 'bridge_only', SCREENING_ARTIFACTS_APPROVED: 'true',
    SCREENING_RELEASE_MANIFEST_SHA256: 'a'.repeat(64), GMR_SCREENING_ENGINE_API_BASE: 'http://127.0.0.1:1',
    GMR_SCREENING_ENGINE_API_KEY: 'dedicated-fixture-project-key', SCREENING_CHAIN_ID: '2651420', SCREENING_ISSUER_HASH: '4',
    SCREENING_ZKVERIFY_VK_HASH: '0x' + 'b'.repeat(64), SCREENING_ZKVERIFY_DOMAIN_ID: '175', SCREENING_RECEIPT_BRIDGE: HORIZEN_TESTNET_BRIDGE,
    SCREENING_RPC_URL: 'http://127.0.0.1:1' });
  fetchMock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(
    async () => Response.json({ ready: true, release: release() }), { preconnect: globalThis.fetch.preconnect },
  )) as any;
});
afterEach(() => {
  fetchMock.mockRestore();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});
function fixture() {
  const now = Math.floor(Date.now() / 1000);
  const values = ['1', '7', policyHash, schemaHash, '4', '5', '6', '8', '9', String(now), String(now + 31536000), '2651420', '0', BigInt(HORIZEN_TESTNET_BRIDGE).toString(), '10'];
  const input = { ...Object.fromEntries(publicSignalNames.slice(1).map((key, i) => [key, values[i + 1]])),
    writtenScore: '90', speakingScore: '85', profileApproved: '1', interviewPassed: '1', credentialNonce: '1', signatureR8x: '1', signatureR8y: '1', signatureS: '1' };
  return { input, values };
}
test('explicit application approval and exact reviewed release pin are mandatory before transport', async () => {
  process.env.SCREENING_ARTIFACTS_APPROVED = 'false';
  await expect(approvedScreeningArtifacts()).rejects.toThrow('approval');
  process.env.SCREENING_ARTIFACTS_APPROVED = 'true'; delete process.env.SCREENING_RELEASE_MANIFEST_SHA256;
  await expect(approvedScreeningArtifacts()).rejects.toThrow('pin');
  expect(fetchMock).not.toHaveBeenCalled();
});
test('Engine release readiness must be explicit and cannot be a cached positive result', async () => {
  expect((await approvedScreeningArtifacts()).policyHash).toBe(policyHash);
  for (const ready of [false, 'true', null]) {
    fetchMock.mockResolvedValueOnce(Response.json({ ready, release: release() }));
    await expect(approvedScreeningArtifacts()).rejects.toThrow();
  }
});
test('self-operated assurance must be explicitly pinned and cannot be advertised as independent review', async () => {
  const self = { ...release(), releasePolicy: 'self-operated', independentlyReviewed: false, independentContributors: false };
  fetchMock.mockResolvedValueOnce(Response.json({ ready: true, release: self }));
  await expect(approvedScreeningArtifacts()).rejects.toThrow('downgrade');
  process.env.SCREENING_RELEASE_POLICY = 'self-operated';
  fetchMock.mockResolvedValueOnce(Response.json({ ready: true, release: self }));
  expect((await approvedScreeningArtifacts()).independentlyReviewed).toBe(false);
  for (const patch of [{ independentlyReviewed: true }, { independentContributors: true }, { releasePolicy: 'independent-reviewed' }]) {
    fetchMock.mockResolvedValueOnce(Response.json({ ready: true, release: { ...self, ...patch } }));
    await expect(approvedScreeningArtifacts()).rejects.toThrow('disclose');
  }
});
test('rejects every mismatched release binding and uncontributed key', async () => {
  const patches = [{ releaseManifestSHA256: 'c'.repeat(64) }, { policyHash: '99' }, { schemaHash: '99' }, { issuerHash: '99' },
    { vkHash: '0x' + 'c'.repeat(64) }, { chainId: 26514 }, { domainId: 3 }, { bridge: '0x' + '1'.repeat(40) }, { agentId: '1' },
    { verificationNetwork: 'zkVerify' }, { cryptographicSetupVerified: false }, { issuerAx: '0' }, { issuerAy: '01' },
    { vk: { ...release().vk, nPublic: 4 } }, { vk: { ...release().vk, vk_delta_2: gamma } }];
  for (const patch of patches) {
    fetchMock.mockResolvedValueOnce(Response.json({ ready: true, release: { ...release(), ...patch } }));
    await expect(approvedScreeningArtifacts()).rejects.toThrow();
  }
});
test('proof generation sends the witness only to the dedicated Engine and checks exact output', async () => {
  const { input, values } = fixture(), proof = { protocol: 'groth16', pi_a: ['1', '2', '1'] };
  fetchMock.mockImplementation(async (url: any, options: RequestInit) => {
    expect(options.redirect).toBe('error');
    expect((options.headers as any)['X-GMR-Engine-Key']).toBe('dedicated-fixture-project-key');
    if (String(url).endsWith('/prover')) return Response.json({ ready: true, release: release() });
    expect(String(url)).toBe('http://127.0.0.1:1/v1/screening/proofs');
    expect(JSON.parse(String(options.body))).toEqual({ input, publicSignals: values });
    return Response.json({ proof, publicSignals: values, releaseManifestSHA256: release().releaseManifestSHA256, vkHash: release().vkHash, verificationNetwork: 'Volta' });
  });
  expect(await proveScreeningCredential(input, values)).toEqual({ proof, releaseManifestSHA256: release().releaseManifestSHA256, vkHash: release().vkHash });
});
test('changed proof output, expired credentials and changed issuer keys are rejected', async () => {
  const { input, values } = fixture();
  for (const patch of [{ publicSignals: ['wrong'] }, { releaseManifestSHA256: 'c'.repeat(64) }, { vkHash: '0x' + 'c'.repeat(64) }, { verificationNetwork: 'zkVerify' }, { proof: null }]) {
    fetchMock.mockResolvedValueOnce(Response.json({ ready: true, release: release() }));
    fetchMock.mockResolvedValueOnce(Response.json({ proof: {}, publicSignals: values, releaseManifestSHA256: release().releaseManifestSHA256, vkHash: release().vkHash, verificationNetwork: 'Volta', ...patch }));
    await expect(proveScreeningCredential(input, values)).rejects.toThrow();
  }
  const otherIssuer = [...values]; otherIssuer[5] = '99';
  await expect(proveScreeningCredential(input, otherIssuer)).rejects.toThrow('issuer key');
  const expired = [...values]; expired[9] = '1'; expired[10] = '31536001';
  await expect(proveScreeningCredential(input, expired)).rejects.toThrow('Expired');
});
test('provider failure has no application-local proving fallback', async () => {
  process.env.SCREENING_WASM_PATH = '/not-a-real-file'; process.env.SCREENING_ZKEY_PATH = '/not-a-real-file';
  fetchMock.mockResolvedValueOnce(Response.json({ error: 'private diagnostic' }, { status: 503 }));
  await expect(approvedScreeningArtifacts()).rejects.toThrow('unavailable');
});
test('rejects public plaintext transport and bounds streamed Engine responses', async () => {
  process.env.GMR_SCREENING_ENGINE_API_BASE = 'http://public-engine.example';
  await expect(approvedScreeningArtifacts()).rejects.toThrow('HTTPS');
  expect(fetchMock).not.toHaveBeenCalled();
  process.env.GMR_SCREENING_ENGINE_API_BASE = 'http://127.0.0.1:1';
  fetchMock.mockResolvedValueOnce(new Response('x'.repeat(65537)));
  await expect(approvedScreeningArtifacts()).rejects.toThrow('limit');
});
test('submission uses the approved Engine VK, refuses redirects and preserves ambiguous failures', async () => {
  const check = spyOn(horizenReceiptReader, 'check').mockResolvedValue({} as any);
  const { values } = fixture();
  fetchMock.mockImplementation(async (url: any, options: RequestInit) => {
    expect(options.redirect).toBe('error');
    if (String(url).endsWith('/prover')) return Response.json({ ready: true, release: release() });
    expect(String(url)).toBe('http://127.0.0.1:1/v1/zkverify/proofs');
    expect(JSON.parse(String(options.body)).vk).toEqual(release().vk);
    return new Response('unavailable', { status: 503 });
  });
  try { await expect(submitBridgeScreeningProof({}, values)).rejects.toThrow('reconciliation'); }
  finally { check.mockRestore(); }
});
