import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseTallyProof, type TallyProof } from '../src/services/anonymousReviews/tallyPolicy';
import { ReviewTallyProver } from '../src/services/anonymousReviews/tallyProver';
const { createTallyProverServer } = require('../../zk/review-tally/prover-server.mjs');
const saved = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]; Object.assign(process.env, saved); });
const binary = new URL('../../zk/review-tally/target/release/review-tally-host', import.meta.url).pathname;

test('proof envelope rejects development labels, unrelated data, unbounded and malformed receipts', () => {
  const good: TallyProof = { proof: '0x01', publicSignals: `0x${'0'.repeat(1984)}`, vk: `0x${'ab'.repeat(32)}`, version: 'V2_3', proofSystem: 'risc0', localVerified: true };
  expect(parseTallyProof(good)).toEqual(good);
  for (const bad of [{ ...good, contents: [] }, { ...good, localVerified: false }, { ...good, version: 'V3_0' },
    { ...good, proof: '0x1' }, { ...good, publicSignals: '0x00' }]) expect(() => parseTallyProof(bad)).toThrow();
});
test.skipIf(!existsSync(binary))('local prover checks binary/program pins, private service authentication and forbids external witness outsourcing', async () => {
  const pin = createHash('sha256').update(readFileSync(binary)).digest('hex');
  const metadata = JSON.parse(execFileSync(binary, ['metadata'], { encoding: 'utf8' }));
  const token = '12'.repeat(32), server = createTallyProverServer({ binary, pin, token, port: 0, hostname: '127.0.0.1' });
  try {
    const url = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect((await fetch(`${url}/metadata`, { method: 'POST', body: '{}' })).status).toBe(401);
    const auth = { 'X-Tally-Prover-Key': token, 'Content-Type': 'application/json' };
    const response = await fetch(`${url}/metadata`, { method: 'POST', headers: auth, body: '{}' });
    expect(response.status).toBe(200); expect((await response.json() as any).binarySha256).toBe(pin);
    expect((await fetch(`${url}/shell`, { method: 'POST', headers: auth, body: '{}' })).status).toBe(404);
    expect((await fetch(`${url}/prove`, { method: 'POST', headers: auth, body: '{}' })).status).toBe(503);
    process.env.ANONYMOUS_REVIEW_TALLY_ENABLED = 'true'; process.env.ANONYMOUS_REVIEWS_DEPLOYMENT_BLOCK = '10';
    process.env.ANONYMOUS_REVIEW_TALLY_IMAGE_ID = metadata.imageId; process.env.ANONYMOUS_REVIEW_TALLY_PROVER = binary;
    process.env.ANONYMOUS_REVIEW_TALLY_PROVER_SHA256 = pin;
    const prover = new ReviewTallyProver(); expect((await prover.check()).imageId).toBe(metadata.imageId);
    process.env.ANONYMOUS_REVIEW_TALLY_PROVER_SHA256 = '0'.repeat(64); await expect(prover.check()).rejects.toThrow('not installed');
    process.env.ANONYMOUS_REVIEW_TALLY_PROVER_URL = 'https://external-prover.example';
    await expect(prover.check()).rejects.toThrow('not configured');
  } finally { server.stop(true); }
});
