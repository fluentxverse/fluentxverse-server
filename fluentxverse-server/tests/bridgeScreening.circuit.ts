import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { signScreeningCredential, assertCredentialCurrent } from '../src/services/screening/credential';
import { screeningFixture } from './screening.fixture';
import { HORIZEN_TESTNET_BRIDGE } from '../src/services/proof.services/horizenReceipt';
import { approvedScreeningArtifacts } from '../src/services/screening/prover';

const build = resolve('circuits/tutor-screening-v2/build');
const binding = { chainId: 2651420, agentId: '0', adapterAddress: HORIZEN_TESTNET_BRIDGE };
const signed = await signScreeningCredential(screeningFixture(), binding, Buffer.alloc(32, 7));
assertCredentialCurrent(signed.publicSignals, binding, signed.signals.issuerHash);
// Exercise the worker directly with development assets, never approve them for the runtime.
process.env.SCREENING_ARTIFACTS_APPROVED = 'false';
assert.throws(approvedScreeningArtifacts, /approval/);
const result = await new Promise<any>((success, failure) => {
  const child = execFile('node', [resolve('src/services/screening/prove.mjs')], { timeout: 180_000, maxBuffer: 64000,
    env: { PATH: process.env.PATH, SCREENING_WASM_PATH: `${build}/tutor_screening_js/tutor_screening.wasm`,
      SCREENING_ZKEY_PATH: `${build}/test-only.zkey`, SCREENING_VK_PATH: `${build}/test-only-vk.json` } }, (error, stdout) => {
    if (error) failure(error); else { try { success(JSON.parse(stdout)); } catch (error) { failure(error); } }
  });
  child.stdin!.end(JSON.stringify({ input: signed.input, expectedSignals: signed.publicSignals }));
});
assert.deepEqual(result.publicSignals, signed.publicSignals); assert.equal(result.proof.protocol, 'groth16');
assert.equal(result.publicSignals[12], '0'); assert.equal(result.publicSignals[13], BigInt(HORIZEN_TESTNET_BRIDGE).toString());
console.log('PASS real bridge-bound screening Groth16 proof, locally verified with development-only artifacts; no registration, contract writes or live proof submission');
