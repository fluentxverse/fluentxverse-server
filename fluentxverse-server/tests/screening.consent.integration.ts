import assert from 'node:assert/strict';
import { spyOn } from 'bun:test';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import * as chain from '../src/services/screening/chain';
import { shareScreeningCredential, submitScreeningProof, generateScreeningProof } from '../src/services/screening/service';
import * as prover from '../src/services/screening/prover';
import { sealPrivateEvidence } from '../src/services/screening/storage';
import { signScreeningCredential } from '../src/services/screening/credential';
import { screeningFixture } from './screening.fixture';
import { HORIZEN_TESTNET_BRIDGE } from '../src/services/proof.services/horizenReceipt';

const uri = process.env.TEST_MEMGRAPH_URI;
if (!uri || !/^bolt:\/\/127\.0\.0\.1:\d+$/.test(uri)) throw new Error('An empty isolated loopback Memgraph is required');
await initDriver(uri, '', '');
const session = getDriver().session();
const mocks: { mockRestore(): void }[] = [];
try {
  assert.equal((await session.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n').toNumber(), 0);
  process.env.SCREENING_ENABLED = 'true'; // This process only; transport below is strictly mocked.
  process.env.SCREENING_RELEASE_MANIFEST_SHA256 = 'a'.repeat(64);
  process.env.SCREENING_EVIDENCE_KEY_HEX = '12'.repeat(32);
  const evidence = screeningFixture(), binding = { chainId: 2651420, agentId: '0', adapterAddress: HORIZEN_TESTNET_BRIDGE };
  const signed = await signScreeningCredential(evidence, binding, Buffer.alloc(32, 7));
  const commitment = signed.signals.credentialCommitment;
  const config = { ...binding, bridge: HORIZEN_TESTNET_BRIDGE, domainId: 175, rpcUrl: 'http://127.0.0.1:1',
    vkHash: ('0x' + 'ab'.repeat(32)) as `0x${string}`, issuerHash: signed.signals.issuerHash };
  await session.run(`CREATE (c:TutorScreeningCredential {id: 'synthetic-consent-test', tutorId: $tutorId,
    commitment: $commitment, publicSignals: $signals, proof: '{}', encryptedEvidence: $encrypted,
    provingReleaseSHA256: $release, proofVKHash: $vk, shared: false, revoked: false, status: 'proof_ready', issuedAt: $issuedAt, expiresAt: $expiresAt})`,
    { tutorId: evidence.tutorId, commitment, release: process.env.SCREENING_RELEASE_MANIFEST_SHA256, vk: config.vkHash,
      encrypted: sealPrivateEvidence(Buffer.from(JSON.stringify({ input: signed.input })), 'synthetic-consent-test'),
      signals: JSON.stringify(signed.publicSignals), issuedAt: signed.signals.issuedAt, expiresAt: signed.signals.expiresAt });
  mocks.push(spyOn(chain, 'screeningChainConfig').mockReturnValue(config as any));
  const check = spyOn(chain, 'assertValidatorConfiguration').mockResolvedValue(undefined as any); mocks.push(check);
  const submit = spyOn(chain, 'submitBridgeScreeningProof').mockResolvedValue({ submission: {
    id: 'synthetic-no-chain-transaction', transactionResult: JSON.stringify({ txHash: '0x' + 'cd'.repeat(32),
      status: 'Finalized', statement: chain.screeningLeaf(config.vkHash, signed.publicSignals) }),
  } } as any); mocks.push(submit);
  await assert.rejects(submitScreeningProof(commitment, 'synthetic-admin'), /consent/);
  assert.equal(submit.mock.calls.length, 0);

  const generated = { proof: { fixture: 'new-release-proof' }, releaseManifestSHA256: 'a'.repeat(64), vkHash: config.vkHash };
  const proofWorker = spyOn(prover, 'proveScreeningCredential').mockResolvedValue(generated); mocks.push(proofWorker);
  await session.run('MATCH(c:TutorScreeningCredential) SET c.provingReleaseSHA256=$release', { release: 'b'.repeat(64) });
  await generateScreeningProof(commitment, 'synthetic-admin');
  let regenerated = (await session.run('MATCH(c:TutorScreeningCredential) RETURN c')).records[0]!.get('c').properties;
  assert.equal(regenerated.provingReleaseSHA256, generated.releaseManifestSHA256);
  assert.equal(regenerated.proof, JSON.stringify(generated.proof));
  await session.run('MATCH(c:TutorScreeningCredential) SET c.provingReleaseSHA256=$release', { release: 'b'.repeat(64) });
  proofWorker.mockImplementationOnce(async () => {
    await session.run("MATCH(c:TutorScreeningCredential) SET c.status='submitting_zkverify'");
    return { ...generated, proof: { fixture: 'late-worker-must-not-overwrite' } };
  });
  await assert.rejects(generateScreeningProof(commitment, 'synthetic-admin'), /changed while/);
  regenerated = (await session.run('MATCH(c:TutorScreeningCredential) RETURN c')).records[0]!.get('c').properties;
  assert.equal(regenerated.proof, JSON.stringify(generated.proof));
  await session.run("MATCH(c:TutorScreeningCredential) SET c.status='proof_ready',c.provingReleaseSHA256=$release", { release: generated.releaseManifestSHA256 });

  await shareScreeningCredential(evidence.tutorId, commitment, true);
  await session.run('MATCH(c:TutorScreeningCredential) SET c.provingReleaseSHA256=$release', { release: 'b'.repeat(64) });
  await assert.rejects(submitScreeningProof(commitment, 'synthetic-admin'), /release/);
  assert.equal(submit.mock.calls.length, 0, 'Release rotation must not broadcast an old proof');
  await session.run('MATCH(c:TutorScreeningCredential) SET c.provingReleaseSHA256=$release', { release: process.env.SCREENING_RELEASE_MANIFEST_SHA256 });
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  check.mockImplementationOnce(async () => { started(); await gate; return undefined as any; });
  const pending = submitScreeningProof(commitment, 'synthetic-admin');
  await entered;
  await shareScreeningCredential(evidence.tutorId, commitment, false);
  release();
  await assert.rejects(pending, /reconciliation/);
  assert.equal(submit.mock.calls.length, 0, 'Concurrent consent withdrawal must win before the database claim');

  await shareScreeningCredential(evidence.tutorId, commitment, true);
  const result = await submitScreeningProof(commitment, 'synthetic-admin');
  assert.equal(result.status, 'awaiting_horizen_validation');
  assert.equal(submit.mock.calls.length, 1);
  await submitScreeningProof(commitment, 'synthetic-admin');
  assert.equal(submit.mock.calls.length, 1, 'An already submitted proof must not be sent again');
  const saved = (await session.run('MATCH(c:TutorScreeningCredential) RETURN c')).records[0]!.get('c').properties;
  assert.equal(saved.publicSignals, JSON.stringify(signed.publicSignals));
  assert.ok(saved.publicationAuthorizedAt);
  console.log('PASS real Memgraph release rotation, late proof fencing, consent gate, concurrent withdrawal, immutable statement and idempotent retry; mocked Engine only, no chain transactions.');
} finally { mocks.forEach(mock => mock.mockRestore()); await session.close(); await closeDriver(); }
