import { afterEach, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { assertHorizenReceiptConfig, HORIZEN_MAINNET_BRIDGE, HORIZEN_TESTNET_BRIDGE, horizenVerificationNetwork } from '../src/services/proof.services/horizenReceipt';
import { reviewConfig, reviewGroupId, reviewScope, reviewStatement } from '../src/services/anonymousReviews/policy';
import { AnonymousReviewChain } from '../src/services/anonymousReviews/chain';
import { passConfig } from '../src/services/lessonPasses/policy';
import { tallyContext } from '../src/services/anonymousReviews/tallyPolicy';

const env = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
const hash = `0x${'ab'.repeat(32)}` as const;
function reviewEnvironment() {
  const keys = JSON.parse(readFileSync(new URL('../src/verification-keys.json', import.meta.resolve('@semaphore-protocol/proof')), 'utf8'));
  Object.assign(process.env, { PRIVACY_INFRA_MODE: 'bridge_only', ANONYMOUS_REVIEWS_CHAIN_ID: '26514',
    ANONYMOUS_REVIEWS_BRIDGE: HORIZEN_MAINNET_BRIDGE, ANONYMOUS_REVIEWS_DOMAIN_ID: '3', ANONYMOUS_REVIEWS_RPC_URL: 'https://horizen.calderachain.xyz/http',
    ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH: hash, ANONYMOUS_REVIEWS_WASM_SHA256: 'a'.repeat(64), ANONYMOUS_REVIEWS_ZKEY_SHA256: 'b'.repeat(64),
    ANONYMOUS_REVIEWS_VK_SHA256: createHash('sha256').update(JSON.stringify({ ...keys, vk_delta_2: keys.vk_delta_2[7], IC: keys.IC[7] })).digest('hex'),
    GMR_ANONYMOUS_REVIEWS_ENGINE_API_BASE: 'https://fixture-engine.invalid', GMR_ANONYMOUS_REVIEWS_ENGINE_API_KEY: 'synthetic-test-only' });
}
test('official mainnet and testnet tuples cannot be mixed', () => {
  const mainnet = { chainId: 26514, bridge: HORIZEN_MAINNET_BRIDGE, domainId: 3, rpcUrl: 'https://horizen.calderachain.xyz/http' };
  expect(() => assertHorizenReceiptConfig(mainnet)).not.toThrow();
  expect(horizenVerificationNetwork(26514)).toBe('zkVerify'); expect(horizenVerificationNetwork(2651420)).toBe('Volta');
  expect(() => horizenVerificationNetwork(84532)).toThrow();
  for (const patch of [{ domainId: 175 }, { bridge: HORIZEN_TESTNET_BRIDGE }, { chainId: 2651420 }, { rpcUrl: 'file:///private' }]) {
    expect(() => assertHorizenReceiptConfig({ ...mainnet, ...patch })).toThrow();
  }
});
test('mainnet reviews create new cohorts and cannot reuse a testnet scope', () => {
  reviewEnvironment(); const cfg = reviewConfig(), id = reviewGroupId('tutor', '2026-10');
  expect(cfg.network).toBe('zkVerify'); expect(cfg.domainId).toBe(3); expect(cfg.contract).toBe(HORIZEN_MAINNET_BRIDGE);
  process.env.ANONYMOUS_REVIEWS_CHAIN_ID = '2651420';
  expect(reviewGroupId('tutor', '2026-10')).not.toBe(id);
  expect(reviewScope(2651420, HORIZEN_TESTNET_BRIDGE, id)).not.toBe(reviewScope(26514, HORIZEN_MAINNET_BRIDGE, id));
});
test('review submissions select native mainnet explicitly and reject mislabeled Engine results', async () => {
  reviewEnvironment(); const cfg = reviewConfig(), chain = new AnonymousReviewChain();
  const proof = { merkleTreeDepth: 8, merkleTreeRoot: '1', nullifier: '2', message: '3', scope: '4', points: Array(8).fill('0') } as any;
  const check = spyOn(chain, 'check').mockResolvedValue(cfg); let wrong = false;
  const fetch = spyOn(globalThis, 'fetch').mockImplementation((async (_, input) => {
    const body = JSON.parse(String(input!.body)); expect(body.expectedNetwork).toBe('zkVerify'); expect(body.domainId).toBe(3);
    return Response.json({ submission: { id: 'fixture', zkVerifyNetwork: wrong ? 'Volta' : 'zkVerify', transactionResult: JSON.stringify({ txHash: hash, statement: reviewStatement(cfg.vkHash, proof) }) } });
  }) as typeof globalThis.fetch);
  try { expect((await chain.submit(proof)).submissionId).toBe('fixture'); wrong = true; await expect(chain.submit(proof)).rejects.toThrow('Wrong review proof network'); }
  finally { check.mockRestore(); fetch.mockRestore(); }
});
test('archived pass contracts cannot be reactivated by a mainnet configuration', () => {
  Object.assign(process.env, { LESSON_BOOKING_MODE: 'paid', LESSON_PASSES_ENABLED: 'true', PRIVACY_INFRA_MODE: 'legacy_contracts',
    LESSON_PASSES_CHAIN_ID: '26514', LESSON_PASSES_DOMAIN_ID: '3', LESSON_PASSES_RPC_URL: 'https://horizen.calderachain.xyz/http',
    LESSON_PASSES_CONTRACT: `0x${'1'.repeat(40)}`, LESSON_PASSES_ISSUER: `0x${'2'.repeat(40)}`, LESSON_PASSES_BRIDGE: HORIZEN_MAINNET_BRIDGE,
    LESSON_PASSES_VK_HASH: hash, LESSON_PASSES_VK_SHA256: 'a'.repeat(64), LESSON_PASSES_WASM_SHA256: 'a'.repeat(64), LESSON_PASSES_ZKEY_SHA256: 'a'.repeat(64) });
  expect(passConfig).toThrow('archived'); process.env.LESSON_PASSES_DOMAIN_ID = '175'; expect(passConfig).toThrow('archived');
});
test('the existing testnet-only Risc0 tally artifact cannot be relabeled as mainnet', () => {
  expect(() => tallyContext({ chainId: 26514 } as any)).toThrow();
});
