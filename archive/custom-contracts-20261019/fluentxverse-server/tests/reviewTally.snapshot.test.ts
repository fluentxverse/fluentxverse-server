import { afterEach, expect, test } from 'bun:test';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseAbiItem, toHex, type Hex } from 'viem';
import { tallyFixture } from './reviewTally.fixture';
import { AnonymousReviewChain, anonymousReviewAbi } from '../src/services/anonymousReviews/chain';
import { ReviewTallySnapshotSource } from '../src/services/anonymousReviews/tallySnapshot';
import { reviewConfig } from '../src/services/anonymousReviews/policy';
import { tallyManifestHash, word } from '../src/services/anonymousReviews/tallyPolicy';
import type { ReviewCohort } from '../src/services/anonymousReviews/repository';

const env = { ...process.env };
afterEach(() => { for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]; Object.assign(process.env, env); });
test('RPC census includes all accepted reviews and rejects omission, false storage, future and changed checkpoints', async () => {
  process.env.PRIVACY_INFRA_MODE = 'legacy_contracts';
  const f = tallyFixture(6), s = f.witness.snapshot, opensAt = s.closesAt - 7 * 86400;
  process.env.ANONYMOUS_REVIEW_TALLY_ENABLED = 'true'; process.env.ANONYMOUS_REVIEW_TALLY_IMAGE_ID = `0x${'ef'.repeat(32)}`;
  process.env.ANONYMOUS_REVIEWS_DEPLOYMENT_BLOCK = '10'; process.env.ANONYMOUS_REVIEWS_CONTRACT = s.registry;
  process.env.ANONYMOUS_REVIEWS_BRIDGE = '0x3098A6974649478f0133046e44105AA84e868C21'; process.env.ANONYMOUS_REVIEWS_DOMAIN_ID = '175';
  process.env.ANONYMOUS_REVIEWS_ZKVERIFY_VK_HASH = s.reviewVk; process.env.ANONYMOUS_REVIEWS_WASM_SHA256 = 'a'.repeat(64);
  process.env.ANONYMOUS_REVIEWS_ZKEY_SHA256 = 'b'.repeat(64);
  const event = parseAbiItem('event ReviewAccepted(uint256 indexed scopeHash, uint256 indexed nullifier, uint256 messageHash, bytes32 statement)');
  const abi = [...anonymousReviewAbi, parseAbiItem('function reviewKey(uint256,uint256) pure returns(bytes32)')];
  let corruptStorage = false, changedBlock = false;
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    const { id, method, params } = await request.json() as any;
    let result: unknown;
    if (method === 'eth_getBlockByNumber') {
      const n = params[0] === 'finalized' ? 30 : Number(BigInt(params[0]));
      const timestamp = n <= 10 ? opensAt - (10 - n) * 86400 : n >= 30 ? s.blockTimestamp : opensAt + Math.floor((n - 10) / 20 * 7 * 86400);
      result = { number: toHex(n), hash: n === 30 ? (changedBlock ? word(999) : s.blockHash) : word(n + 100), parentHash: word(n + 99),
        timestamp: toHex(timestamp), gasLimit: '0x10000', gasUsed: '0x1', difficulty: '0x0', totalDifficulty: '0x0',
        size: '0x1', nonce: '0x0000000000000000', miner: `0x${'0'.repeat(40)}`, extraData: '0x', transactions: [], uncles: [],
        receiptsRoot: word(1), stateRoot: word(1), transactionsRoot: word(1), logsBloom: `0x${'0'.repeat(512)}` };
    } else if (method === 'eth_getLogs') {
      expect(params[0].topics[1]).toBe(s.scopeHash);
      result = s.accepted.map((v, i) => ({ address: s.registry,
        topics: encodeEventTopics({ abi: [event], eventName: 'ReviewAccepted', args: { scopeHash: BigInt(s.scopeHash), nullifier: BigInt(v.nullifier) } }),
        data: encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }], [BigInt(v.messageHash), v.statement]),
        blockNumber: toHex(11 + i), blockHash: word(111 + i), transactionHash: word(1000 + i), transactionIndex: '0x0', logIndex: '0x0', removed: false }));
    } else if (method === 'eth_call') {
      const { functionName, args } = decodeFunctionData({ abi, data: params[0].data });
      expect(params[1]).toBe('0x1e');
      if (functionName === 'cohorts') result = encodeFunctionResult({ abi, functionName, result: [BigInt(s.root), BigInt(opensAt), BigInt(s.closesAt), 6] });
      else if (functionName === 'reviewKey') result = encodeFunctionResult({ abi, functionName, result: keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], args as [bigint, bigint])) });
      else if (functionName === 'accepted') {
        const item = s.accepted.find(v => keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [BigInt(s.scopeHash), BigInt(v.nullifier)])) === args![0]);
        result = encodeFunctionResult({ abi, functionName, result: corruptStorage ? word(0) : item!.statement });
      } else throw new Error('Unexpected synthetic RPC call');
    } else throw new Error('Unexpected synthetic RPC method');
    return Response.json({ jsonrpc: '2.0', id, result });
  } });
  process.env.ANONYMOUS_REVIEWS_RPC_URL = `http://127.0.0.1:${server.port}`;
  const chain = new AnonymousReviewChain(); chain.check = async () => reviewConfig();
  const source = new ReviewTallySnapshotSource(chain);
  const cohort: ReviewCohort = { id: s.groupId, tutorId: 'synthetic-tutor', period: '2020-01', scope: f.scope, chainId: s.chainId,
    contract: s.registry, root: BigInt(s.root).toString(), membersJson: JSON.stringify(f.members),
    opensAt: new Date(opensAt * 1000).toISOString(), closesAt: new Date(s.closesAt * 1000).toISOString() };
  try {
    const collected = await source.collect(cohort); expect(tallyManifestHash(collected)).toBe(tallyManifestHash(s));
    await expect(source.complete(cohort, { ...s, accepted: s.accepted.slice(0, 5) })).rejects.toThrow('omitted or changed');
    corruptStorage = true; await expect(source.collect(cohort)).rejects.toThrow('registry storage'); corruptStorage = false;
    await expect(source.collect(cohort, { blockNumber: 31, blockHash: s.blockHash })).rejects.toThrow('canonical and finalized');
    changedBlock = true; await expect(source.complete(cohort, s)).rejects.toThrow('canonical and finalized');
    changedBlock = false; await source.complete(cohort, s);
  } finally { server.stop(true); }
});
