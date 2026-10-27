import { afterEach, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Group } from '@semaphore-protocol/group';
import { HORIZEN_TESTNET_BRIDGE, HorizenReceiptReader, horizenReceiptReader, privacyInfrastructure, validateHorizenReceipt } from '../src/services/proof.services/horizenReceipt';
import { AnonymousReviewChain } from '../src/services/anonymousReviews/chain';
import { reviewConfig, reviewGroupId, reviewScope } from '../src/services/anonymousReviews/policy';
import { AnonymousReviewRepository } from '../src/services/anonymousReviews/repository';
import { AnonymousReviewService } from '../src/services/anonymousReviews/service';
import { registerScreeningAgent } from '../src/services/screening/service';
import { gmrScreeningEngine } from '../src/services/web3.services/gmrScreeningEngine.service';
import { screeningChainConfig } from '../src/services/screening/chain';
import { ReviewTallySnapshotSource } from '../src/services/anonymousReviews/tallySnapshot';
import { tallyManifestHash } from '../src/services/anonymousReviews/tallyPolicy';

const env = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
const hash = `0x${'ab'.repeat(32)}` as const;
const config = { chainId: 2651420, bridge: HORIZEN_TESTNET_BRIDGE, domainId: 175, rpcUrl: 'http://127.0.0.1:1' };
const receipt = { aggregationId: '1215', merklePath: [], leafCount: '1', index: '0' };
function reviews() {
  Object.assign(process.env, { PRIVACY_INFRA_MODE: 'bridge_only', ANONYMOUS_REVIEWS_ENABLED: 'true',
    ANONYMOUS_REVIEWS_CHAIN_ID: '2651420', ANONYMOUS_REVIEWS_BRIDGE: HORIZEN_TESTNET_BRIDGE, ANONYMOUS_REVIEWS_DOMAIN_ID: '175', ANONYMOUS_REVIEWS_RPC_URL: config.rpcUrl,
    ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH: hash, ANONYMOUS_REVIEWS_WASM_SHA256: 'a'.repeat(64), ANONYMOUS_REVIEWS_ZKEY_SHA256: 'b'.repeat(64) });
  delete process.env.ANONYMOUS_REVIEWS_CONTRACT;
  const keys = JSON.parse(readFileSync(new URL('../src/verification-keys.json', import.meta.resolve('@semaphore-protocol/proof')), 'utf8'));
  process.env.ANONYMOUS_REVIEWS_VK_SHA256 = createHash('sha256').update(JSON.stringify({ ...keys, vk_delta_2: keys.vk_delta_2[7], IC: keys.IC[7] })).digest('hex');
}
test('bridge-only is the default and unknown infrastructure fails closed', () => {
  delete process.env.PRIVACY_INFRA_MODE; expect(privacyInfrastructure()).toBe('bridge_only');
  process.env.PRIVACY_INFRA_MODE = 'typo'; expect(privacyInfrastructure).toThrow();
});
test('retired screening API client cannot send requests even with an Engine connection', async () => {
  const { GmrScreeningEngineClient } = await import('../src/services/web3.services/gmrScreeningEngine.service');
  const client = new GmrScreeningEngineClient('http://127.0.0.1:1', 'synthetic-test-key');
  for (const action of ['config', 'register', 'prove', 'submit', 'certify', 'revoke']) {
    await expect(client.operation(action)).rejects.toThrow('archived');
  }
  await expect(client.queue('register')).rejects.toThrow('archived');
});
test('only the official bridge is read at a fixed finalized block; missing roots never verify', async () => {
  let chain = 2651420, code = '0x01', accepted = false, changed = false;
  const calls: any[] = [];
  const client = { getChainId: async () => chain, getBytecode: async (input: any) => { calls.push(input); return code; },
    getBlock: async (input: any) => ({ number: input.blockNumber ?? 100n, hash: changed && input.blockNumber ? `0x${'cd'.repeat(32)}` : hash }),
    readContract: async (input: any) => { calls.push(input); return accepted; } };
  const reader = new HorizenReceiptReader(() => client as any);
  expect(await reader.verify(config, hash, receipt)).toBe(false);
  accepted = true; expect(await reader.verify(config, hash, receipt)).toBe(true);
  expect(calls.every(c => c.address === HORIZEN_TESTNET_BRIDGE && c.blockNumber === 100n)).toBe(true);
  expect(calls.filter(c => c.functionName).every(c => c.functionName === 'verifyProofAggregation')).toBe(true);
  expect(calls.find(c => c.functionName).args).toEqual([175n, 1215n, hash, [], 1n, 0n]);
  changed = true; await expect(reader.verify(config, hash, receipt)).rejects.toThrow('changed'); changed = false;
  await expect(reader.verify(config, hash, receipt, { blockNumber: 101, blockHash: hash })).rejects.toThrow('finalized');
  code = '0x'; await expect(reader.verify(config, hash, receipt)).rejects.toThrow('unavailable'); code = '0x01';
  chain = 84532; await expect(reader.verify(config, hash, receipt)).rejects.toThrow('Wrong');
  await expect(reader.verify({ ...config, bridge: `0x${'1'.repeat(40)}` }, hash, receipt)).rejects.toThrow('Unapproved');
  await expect(reader.verify({ ...config, domainId: 1 }, hash, receipt)).rejects.toThrow('Unapproved');
});
test('receipt parser rejects replay-path ambiguity and malformed values', () => {
  for (const value of [{ ...receipt, index: '1' }, { ...receipt, aggregationId: '01' }, { ...receipt, merklePath: ['0x00'] },
    { ...receipt, leafCount: '0' }, { ...receipt, domainId: 1 }, { ...receipt, leafCount: '2' },
    { ...receipt, merklePath: [`0x${'0'.repeat(64)}`] }]) expect(() => validateHorizenReceipt(value)).toThrow();
});
test('review cohorts and acceptance use the bridge without registry reads or writes', async () => {
  reviews(); const cfg = reviewConfig(), chain = new AnonymousReviewChain();
  expect(cfg.contract).toBe(HORIZEN_TESTNET_BRIDGE);
  const id = reviewGroupId('tutor', '2026-10'), members = ['111', '222', '333', '444', '555'];
  const cohort = { id, tutorId: 'tutor', period: '2026-10', chainId: cfg.chainId, contract: cfg.contract,
    scope: reviewScope(cfg.chainId, cfg.contract, id), root: new Group(members.map(BigInt)).root.toString(), membersJson: JSON.stringify(members),
    opensAt: new Date(Date.now() - 10000).toISOString(), closesAt: new Date(Date.now() + 10000).toISOString(), activationStatus: 'active_bridge' };
  const proof = { merkleTreeDepth: 8, merkleTreeRoot: cohort.root, nullifier: '2', message: '3', scope: cohort.scope, points: Array(8).fill('0') } as any;
  const check = spyOn(horizenReceiptReader, 'check').mockResolvedValue({} as any), verify = spyOn(horizenReceiptReader, 'verify').mockResolvedValue(false);
  try {
    expect(await chain.active(cohort)).toBe(true);
    expect(await chain.active({ ...cohort, activationStatus: 'queued' })).toBe(false);
    expect(await chain.accepted(proof)).toBe(false);
    expect(await chain.accepted(proof, JSON.stringify(receipt))).toBe(false);
    verify.mockResolvedValue(true); expect(await chain.accepted(proof, JSON.stringify(receipt))).toBe(true);
    await expect(chain.certify(proof, receipt)).rejects.toThrow('archived');
    process.env.PRIVACY_INFRA_MODE = 'legacy_contracts';
    expect(() => reviewGroupId('tutor', '2026-10')).toThrow('archived');
  } finally { check.mockRestore(); verify.mockRestore(); }
});
test('review certification persists only after a finalized bridge receipt and never queues a contract transaction', async () => {
  reviews(); const repo = new AnonymousReviewRepository(), chain = new AnonymousReviewChain(), service = new AnonymousReviewService(repo, chain);
  const proof = { merkleTreeDepth: 8, merkleTreeRoot: '1', nullifier: '2', message: '3', scope: '4', points: Array(8).fill('0') };
  const spies = [spyOn(repo, 'submission').mockResolvedValue({ id: 'review', groupId: 'group', nullifier: '2', status: 'awaiting_horizen', zkVerifyTx: hash, proofJson: JSON.stringify(proof), encryptedContent: '' }),
    spyOn(repo, 'cohort').mockResolvedValue({ root: '1', scope: '4' } as any), spyOn(chain, 'accepted').mockResolvedValue(false),
    spyOn(chain, 'active').mockResolvedValue(true), spyOn(chain, 'receipt').mockResolvedValue(false),
    spyOn(repo, 'acceptBridge').mockResolvedValue(), spyOn(chain, 'certify')];
  try {
    await expect(service.certify('review', receipt)).rejects.toThrow('not finalized'); expect(spies[5]).not.toHaveBeenCalled();
    spies[4]!.mockResolvedValue(true as never);
    expect((await service.certify('review', receipt)).verified).toBe(true);
    expect(spies[5]).toHaveBeenCalledWith('review', JSON.stringify(receipt)); expect(spies[6]).not.toHaveBeenCalled();
  } finally { spies.forEach(s => s.mockRestore()); }
});
test('screening binds to the existing bridge with no ERC-8004 identity and blocks agent registration', async () => {
  Object.assign(process.env, { PRIVACY_INFRA_MODE: 'bridge_only', SCREENING_CHAIN_ID: '2651420', SCREENING_ISSUER_HASH: '123',
    SCREENING_ZKVERIFY_VK_HASH: hash, SCREENING_ZKVERIFY_DOMAIN_ID: '175', SCREENING_RPC_URL: config.rpcUrl,
    SCREENING_RECEIPT_BRIDGE: HORIZEN_TESTNET_BRIDGE });
  delete process.env.SCREENING_VALIDATOR_ADDRESS; delete process.env.SCREENING_IDENTITY_REGISTRY;
  const cfg = screeningChainConfig(); expect(cfg.agentId).toBe('0'); expect(cfg.adapterAddress).toBe(HORIZEN_TESTNET_BRIDGE);
  const queue = spyOn(gmrScreeningEngine, 'queue');
  try { await expect(registerScreeningAgent('operator')).rejects.toThrow('disabled'); expect(queue).not.toHaveBeenCalled(); }
  finally { queue.mockRestore(); }
});
test('bridge-only tally snapshots include the platform acceptance set and verify every receipt without a registry census', async () => {
  reviews(); Object.assign(process.env, { ANONYMOUS_REVIEW_TALLY_ENABLED: 'true', ANONYMOUS_REVIEW_TALLY_IMAGE_ID: hash });
  delete process.env.ANONYMOUS_REVIEWS_DEPLOYMENT_BLOCK;
  const cfg = reviewConfig(), chain = new AnonymousReviewChain(), repo = new AnonymousReviewRepository(), source = new ReviewTallySnapshotSource(chain, repo);
  const id = reviewGroupId('tutor', '2020-01'), members = ['111', '222', '333', '444', '555'];
  const cohort = { id, tutorId: 'tutor', period: '2020-01', chainId: cfg.chainId, contract: cfg.contract,
    scope: reviewScope(cfg.chainId, cfg.contract, id), root: new Group(members.map(BigInt)).root.toString(), membersJson: JSON.stringify(members),
    opensAt: '2020-02-01T00:00:00Z', closesAt: '2020-02-08T00:00:00Z', activationStatus: 'active_bridge' };
  let items = members.map((_, i) => ({ id: `review-${i}`, groupId: id, nullifier: String(i + 1), encryptedContent: '', status: 'verified',
    zkVerifyTx: hash, acceptedAt: '2020-02-02T00:00:00Z', receiptJson: JSON.stringify(receipt),
    proofJson: JSON.stringify({ merkleTreeDepth: 8, merkleTreeRoot: cohort.root, nullifier: String(i + 1), message: String(i + 3), scope: cohort.scope, points: Array(8).fill('0') }) }));
  const block = { number: 30n, hash, timestamp: BigInt(Date.parse(cohort.closesAt) / 1000 + 60) };
  const mocks = [spyOn(chain, 'check').mockResolvedValue(cfg), spyOn(chain, 'active').mockResolvedValue(true),
    spyOn(repo, 'submissions').mockImplementation(async () => items), spyOn(horizenReceiptReader, 'verifyBatch').mockResolvedValue(Array(5).fill(true)),
    spyOn(source as any, 'client').mockReturnValue({ getBlock: async () => block, readContract: () => { throw new Error('Must not read an application registry'); } })];
  try {
    const snapshot = await source.collect(cohort); expect(snapshot.registry).toBe(HORIZEN_TESTNET_BRIDGE.toLowerCase());
    expect(snapshot.accepted.length).toBe(5); expect(mocks[3]).toHaveBeenCalledTimes(1);
    expect((mocks[3] as any).mock.calls[0][1]).toHaveLength(5);
    expect(tallyManifestHash(snapshot)).toMatch(/^0x[a-f0-9]{64}$/);
    items[0]!.receiptJson = ''; await expect(source.collect(cohort)).rejects.toThrow('Invalid platform');
    items[0]!.receiptJson = JSON.stringify(receipt); mocks[3]!.mockResolvedValue(Array(5).fill(false) as never);
    await expect(source.collect(cohort)).rejects.toThrow('finalized bridge');
    mocks[3]!.mockResolvedValue(Array(4).fill(true) as never); items = items.slice(0, 4);
    await expect(source.collect(cohort)).rejects.toThrow('closed tally');
  } finally { mocks.forEach(m => m.mockRestore()); }
});
