import { afterEach, expect, spyOn, test } from 'bun:test';
import { EngineProofReceiptClient } from '../src/services/web3.services/gmrProofReceipt.service';
import { AnonymousReviewService } from '../src/services/anonymousReviews/service';
import { AnonymousReviewRepository } from '../src/services/anonymousReviews/repository';
import { AnonymousReviewChain } from '../src/services/anonymousReviews/chain';
import { Group } from '@semaphore-protocol/group';
import { HORIZEN_MAINNET_BRIDGE } from '../src/services/proof.services/horizenReceipt';
import { reviewConfig, reviewGroupId, reviewScope } from '../src/services/anonymousReviews/policy';

const env = { ...process.env }; afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env); });
const id = 'a962a7c7-eb6b-4db5-820b-7b7761349532', hash = `0x${'ab'.repeat(32)}`;
const binding = { network: 'zkVerify', chainId: 26514, domainId: 3, bridge: HORIZEN_MAINNET_BRIDGE, statement: hash } as const;
test('Engine receipt adapter performs only owned reads and requires exact finalized bindings', async () => {
  process.env.GMR_ANONYMOUS_REVIEWS_ENGINE_API_BASE = 'https://engine.fixture.invalid'; process.env.GMR_ANONYMOUS_REVIEWS_ENGINE_API_KEY = 'synthetic-only';
  const candidate = { ...binding, verifiedOnZkVerify: true, verifiedOnHorizen: true, status: 'horizen_finalized', horizenBlock: '123', horizenBlockHash: hash,
    receipt: { aggregationId: '42', merklePath: [], leafCount: '1', index: '0' } };
  let change: Record<string, any> = {};
  const fetch = spyOn(globalThis, 'fetch').mockImplementation((async (url, input) => {
    expect(String(url)).toEndWith(`/v1/zkverify/proofs/${id}/receipt`); expect(input?.body).toBeUndefined();
    expect(input?.method).toBeUndefined(); return Response.json({ submissionId: id, receipt: { ...candidate, ...change } });
  }) as typeof globalThis.fetch);
  const client = new EngineProofReceiptClient('GMR_ANONYMOUS_REVIEWS');
  try {
    expect((await client.reconcile(id, binding)).verified).toBe(true);
    for (const patch of [{ network: 'Volta' }, { domainId: 175 }, { chainId: 2651420 }, { bridge: `0x${'1'.repeat(40)}` },
      { statement: `0x${'cd'.repeat(32)}` }, { verifiedOnZkVerify: false }, { status: 'submitted' }, { horizenBlockHash: '' }]) {
      change = patch; await expect(client.reconcile(id, binding)).rejects.toThrow();
    }
    change = { verifiedOnHorizen: false, status: 'awaiting_aggregation' }; expect((await client.reconcile(id, binding)).verified).toBe(false);
    await expect(client.reconcile('../other-project', binding)).rejects.toThrow();
  } finally { fetch.mockRestore(); }
});
test('automatic acceptance waits for Engine finality, does not send another proof, and rejects historical unbound records', async () => {
  Object.assign(process.env, { ANONYMOUS_REVIEWS_ENABLED: 'true', PRIVACY_INFRA_MODE: 'bridge_only', ANONYMOUS_REVIEWS_CHAIN_ID: '26514',
    ANONYMOUS_REVIEWS_BRIDGE: HORIZEN_MAINNET_BRIDGE, ANONYMOUS_REVIEWS_DOMAIN_ID: '3', ANONYMOUS_REVIEWS_RPC_URL: 'https://horizen.calderachain.xyz/http',
    ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH: hash, ANONYMOUS_REVIEWS_WASM_SHA256: 'a'.repeat(64), ANONYMOUS_REVIEWS_ZKEY_SHA256: 'a'.repeat(64) });
  const config = reviewConfig(), repo = new AnonymousReviewRepository(), chain = new AnonymousReviewChain(), service = new AnonymousReviewService(repo, chain);
  const members = ['11', '22', '33', '44', '55'], groupId = reviewGroupId('fixture-tutor', '2026-10');
  const root = new Group(members.map(BigInt)).root.toString(), scope = reviewScope(config.chainId, config.bridge, groupId);
  let bound = true;
  const spies = [spyOn(repo, 'submission').mockImplementation(async () => ({ id: hash, groupId, status: 'awaiting_horizen', zkVerifyTx: hash, engineSubmissionId: bound ? id : undefined,
    proofJson: JSON.stringify({ merkleTreeDepth: 8, merkleTreeRoot: root, scope, nullifier: '3', message: '4', points: Array(8).fill('0') }), encryptedContent: '', nullifier: '3' })),
    spyOn(repo, 'cohort').mockResolvedValue({ id: groupId, tutorId: 'fixture-tutor', period: '2026-10', chainId: config.chainId, contract: config.bridge, activationStatus: 'active_bridge', root, scope, membersJson: JSON.stringify(members) } as any),
    spyOn(chain, 'reconcile').mockResolvedValue({ verified: false, status: 'awaiting_aggregation' }), spyOn(repo, 'acceptBridge').mockResolvedValue(), spyOn(chain, 'submit')];
  try {
    expect((await service.reconcile(hash)).verified).toBe(false); expect(spies[3]).not.toHaveBeenCalled();
    const receipt = { aggregationId: '42', merklePath: [], leafCount: '1', index: '0' };
    spies[2]!.mockResolvedValue({ verified: true, status: 'horizen_finalized', receipt } as never);
    expect((await service.reconcile(hash)).verified).toBe(true); expect(spies[3]).toHaveBeenCalledWith(hash, JSON.stringify(receipt));
    expect(spies[4]).not.toHaveBeenCalled(); bound = false; await expect(service.reconcile(hash)).rejects.toThrow('bound Engine');
  } finally { spies.forEach(s => s.mockRestore()); }
});
