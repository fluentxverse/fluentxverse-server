import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { signScreeningCredential } from '../src/services/screening/credential';
import { screeningFixture } from './screening.fixture';

const run = promisify(execFile);
const root = resolve('circuits/tutor-screening-v2/build');
const wasm = join(root, 'tutor_screening_js/tutor_screening.wasm');
const signed = await signScreeningCredential(screeningFixture(), { chainId: 2651420, agentId: '12', adapterAddress: `0x${'1'.repeat(40)}` }, Buffer.alloc(32, 7));
console.log('Development credential signed; generating Engine proof.');
const vk = JSON.parse(await readFile(join(root, 'test-only-vk.json'), 'utf8'));
const result = await new Promise<any>((success, failure) => {
  const child = execFile('node', [resolve('../../budol/gmr-engine/scripts/screening-proof-worker.mjs')], { timeout: 150_000 }, (error, stdout) => {
    if (error) return failure(error);
    try { success(JSON.parse(stdout)); } catch (error) { failure(error); }
  });
  child.stdin!.end(JSON.stringify({ input: signed.input, expectedSignals: signed.publicSignals,
    artifacts: { wasm, zkey: join(root, 'test-only.zkey') }, vk }));
});
const { proof } = result;
assert.equal(proof.protocol, 'groth16');
const dir = await mkdtemp(join(tmpdir(), 'screening-circuit-test-'));
try {
  const changes: Record<string, unknown>[] = [
    { writtenScore: '89' }, { writtenScore: '101' }, { writtenScore: '256' },
    { speakingScore: '84' }, { speakingScore: '101' }, { profileApproved: '0' }, { interviewPassed: '0' },
    { subjectHash: '123' }, { credentialNonce: '123' }, { signatureS: '1' },
    { policyHash: '123' }, { schemaHash: '123' }, { attemptHash: '123' }, { evidenceRoot: '123' },
    { expiresAt: String(Number(signed.signals.expiresAt) + 1) }, { chainId: '84532' }, { agentId: '13' }, { adapterAddress: '123' },
  ];
  for (const changeset of changes) {
    const input = join(dir, 'input.json');
    await writeFile(input, JSON.stringify({ ...signed.input, ...changeset }), { mode: 0o600 });
    await assert.rejects(run('node', [join(root, 'tutor_screening_js/generate_witness.js'), wasm, input, join(dir, 'witness.wtns')], { timeout: 30_000 }));
  }
  console.log(`Groth16 proof locally verified; ${changes.length} tampered witnesses rejected. Development-only setup, not approved for deployment.`);
} finally { await rm(dir, { recursive: true, force: true }); }
process.exit(0);
