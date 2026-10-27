import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildEddsa, buildPoseidon } from 'circomlibjs';
import { signScreeningCredential } from '../src/services/screening/credential';
import { screeningFixture } from './screening.fixture';
import { HORIZEN_TESTNET_BRIDGE } from '../src/services/proof.services/horizenReceipt';

// No setup keys or witness files: test freshly compiled constraints in memory.
const root = resolve(process.argv[2] || 'circuits/tutor-screening-v2/build');
const require = createRequire(import.meta.url);
const calculate = await require(resolve('..', 'node_modules/circom_runtime')).WitnessCalculatorBuilder(
  await readFile(resolve(root, 'tutor_screening_js/tutor_screening.wasm')));
const seed = Buffer.alloc(32, 7), poseidon = await buildPoseidon(), eddsa = await buildEddsa();
const signed = await signScreeningCredential(screeningFixture(), { chainId: 2651420, agentId: '0', adapterAddress: HORIZEN_TESTNET_BRIDGE }, seed);
const names = ['writtenScore', 'speakingScore', 'profileApproved', 'interviewPassed', 'credentialCommitment', 'policyHash',
  'schemaHash', 'issuerHash', 'evidenceRoot', 'attemptHash', 'issuedAt', 'expiresAt', 'chainId', 'agentId', 'adapterAddress'];
let rejected = 0;
for (const [written, speaking, accepted] of [[90, 85, true], [100, 100, true], [89, 85, false], [90, 84, false],
  [101, 85, false], [300, 85, false], [90, 101, false], [90, 300, false], [-1, 85, false]]) {
  const input = { ...signed.input, writtenScore: String(written), speakingScore: String(speaking) } as Record<string, string>;
  // Re-sign every boundary case; rejection must come from score constraints, not a bad signature.
  const message = poseidon(names.map(name => BigInt(input[name]!)));
  const signature = eddsa.signPoseidon(seed, message);
  Object.assign(input, { signatureR8x: eddsa.F.toObject(signature.R8[0]).toString(), signatureR8y: eddsa.F.toObject(signature.R8[1]).toString(),
    signatureS: signature.S.toString() });
  assert.equal(eddsa.verifyPoseidon(message, signature, eddsa.prv2pub(seed)), true);
  if (accepted) await calculate.calculateWitness(input, true);
  else { await assert.rejects(calculate.calculateWitness(input, true)); rejected++; }
}
console.log(`PASS signed boundary witnesses: 2 accepted, ${rejected} rejected by circuit constraints; no setup or chain submission.`);
process.exit(0);
