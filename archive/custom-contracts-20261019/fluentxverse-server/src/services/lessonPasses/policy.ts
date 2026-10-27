import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { type Hex } from 'viem';
import { passScope, PASS_DEPTH, type PassMode } from '../../shared/lessonPasses';
import { parseReviewProof, reviewPublicSignals, reviewSignalStatement } from '../anonymousReviews/policy';
import { trialLaunchMode, trialLessonLimit } from '../schedule.services/trialPolicy';
import { assertHorizenReceiptConfig, horizenVerificationNetwork, privacyInfrastructure } from '../proof.services/horizenReceipt';

export class PassError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const privatePassMode = () => !trialLaunchMode() && process.env.LESSON_PASSES_ENABLED === 'true';
export function requirePasses() { if (!privatePassMode()) throw new PassError('Private lesson passes are disabled', 503); }
export function passConfig() {
  requirePasses();
  if (privacyInfrastructure() !== 'legacy_contracts') throw new PassError('Paid lesson passes are parked during the bridge-only rollout', 503);
  const contract = (process.env.LESSON_PASSES_CONTRACT || '').toLowerCase() as `0x${string}`;
  const issuer = (process.env.LESSON_PASSES_ISSUER || '').toLowerCase() as `0x${string}`;
  const rpcUrl = process.env.LESSON_PASSES_RPC_URL || '', chainId = Number(process.env.LESSON_PASSES_CHAIN_ID || '2651420');
  const domainId = Number(process.env.LESSON_PASSES_DOMAIN_ID), vkHash = process.env.LESSON_PASSES_VK_HASH as Hex;
  const network = horizenVerificationNetwork(chainId);
  if (!/^https?:\/\//.test(rpcUrl) || !/^0x[a-f0-9]{40}$/.test(contract) || BigInt(contract) === 0n
    || !/^0x[a-f0-9]{40}$/.test(issuer) || BigInt(issuer) === 0n || !/^0x[a-f0-9]{64}$/.test(vkHash || ''))
    throw new PassError('Approved pass ledger configuration is incomplete', 503);
  const pin = (name: string) => { const value = process.env[name] || ''; if (!/^[a-f0-9]{64}$/.test(value)) throw new PassError('Approved pass artifacts are missing', 503); return value; };
  const bridge: `0x${string}` = (process.env.LESSON_PASSES_BRIDGE || '').toLowerCase() as `0x${string}`;
  assertHorizenReceiptConfig({ chainId, bridge, domainId, rpcUrl });
  return { network, chainId, contract, issuer, rpcUrl, domainId, bridge, vkHash, scope: passScope(chainId, contract),
    vkSha256: pin('LESSON_PASSES_VK_SHA256'), artifacts: { wasmUrl: '/anonymous-reviews/semaphore.wasm', zkeyUrl: '/anonymous-reviews/semaphore.zkey',
      wasmSha256: pin('LESSON_PASSES_WASM_SHA256'), zkeySha256: pin('LESSON_PASSES_ZKEY_SHA256') } };
}
export function publicPassMode(): PassMode {
  if (trialLaunchMode()) return { mode: 'trial', trialLessonLimit: trialLessonLimit() };
  if (!privatePassMode()) return { mode: 'legacy_erc1155' };
  const { chainId, contract, artifacts } = passConfig(); return { mode: 'private_passes', chainId, contract, artifacts };
}
export function passVerificationKey() {
  const config = passConfig(), keys = JSON.parse(readFileSync(new URL('../src/verification-keys.json', import.meta.resolve('@semaphore-protocol/proof')), 'utf8'));
  const vk = { ...keys, vk_delta_2: keys.vk_delta_2[PASS_DEPTH - 1], IC: keys.IC[PASS_DEPTH - 1] };
  if (createHash('sha256').update(JSON.stringify(vk)).digest('hex') !== config.vkSha256) throw new PassError('Unapproved pass verification key', 503);
  return vk;
}
export function parsePassProof(input: unknown) {
  try { return parseReviewProof(input); } catch { throw new PassError('Invalid pass ownership proof'); }
}
export const passSignals = reviewPublicSignals;
export function passStatement(proof: ReturnType<typeof parsePassProof>) { return reviewSignalStatement(passConfig().vkHash, passSignals(proof)); }
let verifying = 0;
export async function verifyPassProof(proof: ReturnType<typeof parsePassProof>) {
  passVerificationKey();
  if (verifying >= 2) throw new PassError('Pass verifier is busy', 503);
  verifying++;
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const child = execFile('node', [fileURLToPath(new URL('../anonymousReviews/verify.mjs', import.meta.url))], { timeout: 30_000, maxBuffer: 2048 }, (error, stdout) => {
        if (error) reject(new PassError('Pass verifier unavailable', 503)); else resolve(stdout.trim() === 'true');
      });
      child.stdin?.on('error', () => {}); child.stdin?.end(JSON.stringify(proof));
    });
  } finally { verifying--; }
}
export function validateVault(envelope: string) {
  if (typeof envelope !== 'string' || envelope.length > 262144) throw new PassError('Invalid encrypted recovery vault');
  let value: any;
  try { value = JSON.parse(envelope); } catch { throw new PassError('Invalid encrypted recovery vault'); }
  if (Object.keys(value || {}).sort().join(',') !== 'ciphertext,iterations,iv,kdf,salt,version' || value.version !== 1 || value.kdf !== 'PBKDF2-SHA256'
    || value.iterations !== 600000 || !/^[a-f0-9]{32}$/.test(value.salt || '') || !/^[a-f0-9]{24}$/.test(value.iv || '')
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.ciphertext || '') || value.ciphertext.length < 24)
    throw new PassError('Invalid encrypted recovery vault');
}
