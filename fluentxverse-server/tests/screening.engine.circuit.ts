import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { signScreeningCredential } from '../src/services/screening/credential';
import { screeningFixture } from './screening.fixture';
import { HORIZEN_TESTNET_BRIDGE } from '../src/services/proof.services/horizenReceipt';
import { assertContributedGroth16Key } from '../src/services/proof.services/groth16KeySafety';

const engine = resolve('../../budol/gmr-engine');
const { proveWithArtifacts } = await import(pathToFileURL(resolve(engine, 'scripts/screening-prove.ts')).href);
const { validateBridgeProverInput, bridgeProverOperation } = await import(pathToFileURL(resolve(engine, 'scripts/screening-bridge-prover.ts')).href);
const build = resolve('circuits/tutor-screening-v2/build');
const signed = await signScreeningCredential(screeningFixture(), { chainId: 2651420, agentId: '0', adapterAddress: HORIZEN_TESTNET_BRIDGE }, Buffer.alloc(32, 7));
const config = { enabled: true, chainId: 2651420, domainId: 175, bridge: HORIZEN_TESTNET_BRIDGE, agentId: '0', verificationNetwork: 'Volta',
  policyHash: signed.signals.policyHash, schemaHash: signed.signals.schemaHash, issuerHash: signed.signals.issuerHash,
  issuerAx: signed.signals.issuerAx, issuerAy: signed.signals.issuerAy, vkHash: '0x' + 'a'.repeat(64), releaseManifestSHA256: 'a'.repeat(64) };
const vk = JSON.parse(await readFile(resolve(build, 'test-only-vk.json'), 'utf8'));
assertContributedGroth16Key(vk);
assert.deepEqual(validateBridgeProverInput(config, signed.input, signed.publicSignals), signed.publicSignals);
const proof = await proveWithArtifacts(signed.input, signed.publicSignals, {
  wasm: resolve(build, 'tutor_screening_js/tutor_screening.wasm'), zkey: resolve(build, 'test-only.zkey'),
}, vk);
assert.deepEqual(proof.publicSignals, signed.publicSignals);
assert.equal(proof.certified, false);
assert.equal(proof.proof.protocol, 'groth16');
// Successful development proving does not approve these keys for the production entry point.
await assert.rejects(bridgeProverOperation({ action: 'prove', config, input: signed.input, publicSignals: signed.publicSignals }));
console.log('PASS real Engine worker Groth16 proof with current application policy and official bridge bindings; development keys remain rejected by the release gate. No chain transactions.');
process.exit(0);
