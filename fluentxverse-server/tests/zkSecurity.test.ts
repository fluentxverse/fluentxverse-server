import { afterEach, expect, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import * as memgraph from '../src/db/memgraph';
import Proof from '../src/routes/proof.route';
import { signAuthToken } from '../src/utils/jwt';
import { generateLocalTutorCertificationProof } from '../src/services/proof.services/localGroth16.service';
import { claimStudentLessonProof, getPublicStudentLessonProof } from '../src/services/proof.services/studentLessonProof.service';
import { isZkVerifySubmissionConfigured, submitTutorCertificationProofToZkVerify } from '../src/services/proof.services/zkVerifySubmit.service';
import { getPublicTutorCertificationCredential, getTutorCertificationProofStatus, maybeIssueTutorCertificationProof } from '../src/services/proof.services/tutorCertificationProof.service';
import { assertContributedGroth16Key } from '../src/services/proof.services/groth16KeySafety';
import { HorizenReceiptReader, HORIZEN_TESTNET_BRIDGE } from '../src/services/proof.services/horizenReceipt';
import * as repository from '../src/services/screening/repository';
import * as chain from '../src/services/screening/chain';
import { submitScreeningProof } from '../src/services/screening/service';
import { signScreeningCredential } from '../src/services/screening/credential';
import { screeningFixture } from './screening.fixture';

const env = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
const hash = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const config = { chainId: 2651420, bridge: HORIZEN_TESTNET_BRIDGE, domainId: 175, rpcUrl: 'http://127.0.0.1:1' };
const receipt = { aggregationId: '1', merklePath: [], leafCount: '1', index: '0' };
const row = (values: Record<string, any>) => ({ get: (name: string) => values[name] == null ? null : { properties: values[name] } });

test('legacy proving and submission stay retired even with enable flags', async () => {
  Object.assign(process.env, { ZKVERIFY_ENABLED: 'true', SCREENING_ENABLED: 'true' });
  expect(isZkVerifySubmissionConfigured()).toBe(false);
  for (const task of [() => generateLocalTutorCertificationProof('test'), () => claimStudentLessonProof('student', 'booking'),
    () => submitTutorCertificationProofToZkVerify('test')]) await expect(task()).rejects.toThrow('retired');
});

test('legacy proof routes return 410 and reject cross-role cookies', async () => {
  const app = new Elysia().use(Proof);
  for (const [role, path] of [['tutor', '/tutor-certification/generate-local'], ['tutor', '/tutor-certification/submit-zkverify'],
    ['student', '/student-lessons/booking/claim']] as const) {
    const token = await signAuthToken({ userId: 'test', email: 'test@example.invalid', role }, 60);
    const result = await app.handle(new Request('http://localhost/proof' + path, { method: 'POST', headers: { cookie: `${role}Auth=${token}` } }));
    expect(result.status).toBe(410);
    expect(result.headers.get('cache-control')).toBe('no-store');
  }
  const token = await signAuthToken({ userId: 'test', email: 'test@example.invalid', role: 'student' }, 60);
  expect((await app.handle(new Request('http://localhost/proof/tutor-certification/me', { headers: { cookie: `tutorAuth=${token}` } }))).status).toBe(401);
});

test('legacy status lookups are read-only, do not renew expiry or replace evidence, and never attest verification', async () => {
  const old = { id: 'old', tutorId: 'test', status: 'verified', publicSignals: '{"immutable":"statement"}', localProofVerified: true, expiresAt: '2020-01-01T00:00:00Z' };
  const queries: string[] = [];
  const driver = spyOn(memgraph, 'getDriver').mockReturnValue({ session: () => ({
    run: async (query: string) => {
      queries.push(query);
      if (/StudentLessonProof/.test(query)) return { records: [row({ p: { commitment: '12', status: 'verified', localProofVerified: true } })] };
      if (/RETURN u, c/.test(query)) return { records: [row({ u: { id: 'test' }, c: old })] };
      if (/RETURN c/.test(query)) return { records: [row({ c: old })] };
      if (/RETURN u/.test(query)) return { records: [row({ u: { id: 'test', profileStatus: 'approved' } })] };
      return { records: [] };
    }, close: async () => {},
  }) } as any);
  try {
    for (const lookup of [getTutorCertificationProofStatus, maybeIssueTutorCertificationProof]) {
      const { credential } = await lookup('test');
      expect(credential.status).toBe('expired');
      expect(credential.publicSignals).toEqual({ immutable: 'statement' });
      expect(credential.verificationAvailable).toBe(false);
      expect(credential.expiresAt).toBe(old.expiresAt);
    }
    const publicResult = await getPublicTutorCertificationCredential('12');
    expect(publicResult?.credential.localProofVerified).toBe(false);
    expect(publicResult?.credential.status).toBe('expired');
    old.expiresAt = '2099-01-01T00:00:00Z';
    expect((await getPublicTutorCertificationCredential('12'))?.credential.status).toBe('retired');
    expect((await getPublicStudentLessonProof('12'))?.localProofVerified).toBe(false);
    expect(queries.every(q => !/\b(SET|MERGE|CREATE|DELETE)\b/.test(q))).toBe(true);
  } finally { driver.mockRestore(); }
});

test('initial Groth16 keys and noncanonical encodings cannot pass artifact approval', () => {
  const point = [['1', '2'], ['3', '4'], ['1', '0']];
  const vk = { protocol: 'groth16', curve: 'bn128', vk_gamma_2: point, vk_delta_2: structuredClone(point) };
  expect(() => assertContributedGroth16Key(vk)).toThrow('uncontributed');
  vk.vk_delta_2[0]![0] = '5';
  expect(() => assertContributedGroth16Key(vk)).not.toThrow();
  vk.vk_delta_2[0]![0] = '05';
  expect(() => assertContributedGroth16Key(vk)).toThrow('Noncanonical');
});

test('screening does not contact Engine without tutor consent or after losing the durable consent claim', async () => {
  process.env.SCREENING_ENABLED = 'true';
  process.env.SCREENING_RELEASE_MANIFEST_SHA256 = 'a'.repeat(64);
  const signed = await signScreeningCredential(screeningFixture(), { chainId: 2651420, agentId: '0', adapterAddress: HORIZEN_TESTNET_BRIDGE }, Buffer.alloc(32, 7));
  const stored = { id: 'test', commitment: signed.signals.credentialCommitment, tutorId: 'test', publicSignals: JSON.stringify(signed.publicSignals),
    encryptedEvidence: '', proof: '{}', provingReleaseSHA256: 'a'.repeat(64), proofVKHash: hash,
    status: 'proof_ready', shared: false, revoked: false, issuedAt: signed.signals.issuedAt, expiresAt: signed.signals.expiresAt };
  const spies = [spyOn(repository, 'getScreeningCredential').mockResolvedValue(stored),
    spyOn(chain, 'screeningChainConfig').mockReturnValue({ ...config, vkHash: hash, agentId: '0', adapterAddress: HORIZEN_TESTNET_BRIDGE, issuerHash: signed.signals.issuerHash } as any),
    spyOn(chain, 'assertValidatorConfiguration').mockResolvedValue(undefined as any),
    spyOn(repository, 'screeningQuery').mockResolvedValue({ records: [] } as any),
    spyOn(chain, 'submitBridgeScreeningProof')];
  try {
    await expect(submitScreeningProof(stored.commitment, 'admin')).rejects.toThrow('consent');
    expect(spies[3]).not.toHaveBeenCalled();
    stored.shared = true;
    stored.provingReleaseSHA256 = 'c'.repeat(64);
    await expect(submitScreeningProof(stored.commitment, 'admin')).rejects.toThrow('release');
    expect(spies[2]).not.toHaveBeenCalled();
    expect(spies[3]).not.toHaveBeenCalled();
    stored.provingReleaseSHA256 = 'a'.repeat(64);
    await expect(submitScreeningProof(stored.commitment, 'admin')).rejects.toThrow('reconciliation');
    expect((spies[3] as any).mock.calls[0][0]).toContain('c.shared = true');
    expect((spies[3] as any).mock.calls[0][0]).toContain('c.publicSignals = $signals');
    expect((spies[3] as any).mock.calls[0][0]).toContain('c.provingReleaseSHA256 = $release');
    expect(spies[4]).not.toHaveBeenCalled();
  } finally { spies.forEach(s => s.mockRestore()); }
}, 30000);

test('batch receipt checks reuse one trusted snapshot but never cache a positive result', async () => {
  let accepted = true, changed = false, chains = 0, codes = 0, blocks = 0, reads = 0;
  const client = { getChainId: async () => { chains++; return 2651420; }, getBytecode: async () => { codes++; return '0x01'; },
    getBlock: async (arg: any) => { blocks++; return { number: 10n, hash: changed && arg.blockNumber ? '0x' + 'cd'.repeat(32) : hash }; },
    readContract: async (arg: any) => { reads++; expect(arg.blockNumber).toBe(10n); return accepted; } };
  const reader = new HorizenReceiptReader(() => client as any);
  const entries = Array.from({ length: 5 }, () => ({ statement: hash, receipt }));
  expect(await reader.verifyBatch(config, entries)).toEqual(Array(5).fill(true));
  expect([chains, codes, blocks, reads]).toEqual([1, 1, 2, 5]);
  accepted = false;
  expect(await reader.verifyBatch(config, entries)).toEqual(Array(5).fill(false));
  changed = true;
  await expect(reader.verifyBatch(config, entries)).rejects.toThrow('changed');
});
