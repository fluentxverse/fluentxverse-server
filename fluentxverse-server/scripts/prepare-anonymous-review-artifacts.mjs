import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { REVIEW_DEPTH } from '../src/shared/anonymousReviews.ts';

// Provision reviewed public proving assets explicitly; runtime never prepares keys.
const target = new URL('../../fluentxverse-student-solid-prototype/public/anonymous-reviews/', import.meta.url);
await mkdir(target, { recursive: true });
const pins = {};
for (const extension of ['wasm', 'zkey']) {
  const response = await fetch(`https://snark-artifacts.pse.dev/semaphore/4.13.0/semaphore-${REVIEW_DEPTH}.${extension}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Official Semaphore artifact download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 64 * 1024 * 1024) throw new Error('Unexpectedly large proof asset');
  await writeFile(new URL(`semaphore.${extension}`, target), bytes);
  pins[`ANONYMOUS_REVIEWS_${extension.toUpperCase()}_SHA256`] = createHash('sha256').update(bytes).digest('hex');
}
const keys = JSON.parse(await readFile(new URL('../src/verification-keys.json', import.meta.resolve('@semaphore-protocol/proof')), 'utf8'));
const vk = { ...keys, vk_delta_2: keys.vk_delta_2[REVIEW_DEPTH - 1], IC: keys.IC[REVIEW_DEPTH - 1] };
const { zKey } = createRequire(import.meta.url)('snarkjs');
const exported = await zKey.exportVerificationKey(new Uint8Array(await readFile(new URL('semaphore.zkey', target))));
for (const key of ['protocol', 'curve', 'nPublic', 'vk_alpha_1', 'vk_beta_2', 'vk_gamma_2', 'vk_delta_2', 'IC'])
  if (JSON.stringify(vk[key]) !== JSON.stringify(exported[key])) throw new Error(`Downloaded proving key differs from Semaphore verifier: ${key}`);
pins.ANONYMOUS_REVIEWS_VK_SHA256 = createHash('sha256').update(JSON.stringify(vk)).digest('hex');
await writeFile(new URL('semaphore.vk.json', target), JSON.stringify(vk, null, 2));
console.log('Review and approve these artifact pins before enabling the pilot:');
for (const [name, pin] of Object.entries(pins)) console.log(`${name}=${pin}`);
console.log('Obtain the native zkVerify VK hash separately through Engine/zkVerify; it is NOT the VK-file SHA256.');
process.exit(0);
