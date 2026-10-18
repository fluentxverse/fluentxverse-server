import { createPublicClient, http, parseAbiItem, type Hex, type GetLogsReturnType } from 'viem';
import { Group } from '@semaphore-protocol/group';
import { AnonymousReviewChain, anonymousReviewAbi, type ReviewReceipt } from './chain';
import { AnonymousReviewError, reviewConfig, reviewGroupId, reviewScope, semaphoreHash } from './policy';
import { AnonymousReviewRepository, type ReviewCohort } from './repository';
import { horizenReceiptReader } from '../proof.services/horizenReceipt';
import { parseReviewProof, reviewPublicSignals, reviewStatement } from './policy';
import { tallyConfig, tallyManifestHash, word, type AcceptedReview, type TallySnapshot } from './tallyPolicy';

const event = parseAbiItem('event ReviewAccepted(uint256 indexed scopeHash, uint256 indexed nullifier, uint256 messageHash, bytes32 statement)');
export class ReviewTallySnapshotSource {
  private readonly validated = new Map<string, number>();
  private readonly checking = new Map<string, Promise<void>>();
  constructor(private readonly chain = new AnonymousReviewChain(), private readonly repository = new AnonymousReviewRepository()) {}
  private client() { return createPublicClient({ transport: http(reviewConfig().rpcUrl, { timeout: 15_000, retryCount: 0 }) }); }
  async collect(cohort: ReviewCohort, at?: { blockNumber: number; blockHash: Hex }): Promise<TallySnapshot> {
    const config = await this.chain.check(), tally = tallyConfig(), client = this.client();
    if (!cohort.root || cohort.chainId !== config.chainId || cohort.contract.toLowerCase() !== config.contract.toLowerCase())
      throw new AnonymousReviewError('Wrong tally review deployment', 409);
    const commitments: string[] = JSON.parse(cohort.membersJson || '[]');
    if (cohort.id !== reviewGroupId(cohort.tutorId, cohort.period) || cohort.scope !== reviewScope(config.chainId, config.contract, cohort.id)
      || commitments.length < 5 || commitments.length > 256 || new Set(commitments).size !== commitments.length
      || new Group(commitments.map(BigInt)).root.toString() !== cohort.root)
      throw new AnonymousReviewError('Invalid tally cohort binding or membership root', 409);
    const finalized = await client.getBlock({ blockTag: 'finalized' });
    const block = at ? await client.getBlock({ blockNumber: BigInt(at.blockNumber) }) : finalized;
    if (block.number > finalized.number || (at && block.hash !== at.blockHash)) throw new AnonymousReviewError('Tally snapshot is not canonical and finalized', 409);
    const closesAt = Date.parse(cohort.closesAt) / 1000, scope = BigInt(semaphoreHash(cohort.scope));
    if (!Number.isSafeInteger(closesAt) || block.timestamp < BigInt(closesAt)) throw new AnonymousReviewError('Wait for finalized review window closure', 409);
    if (config.infrastructure === 'bridge_only') {
      if (!await this.chain.active(cohort)) throw new AnonymousReviewError('Bridge-only cohort is inactive', 409);
      const accepted: AcceptedReview[] = [];
      for (const item of await this.repository.submissions(cohort.id)) {
        if (item.status !== 'verified') continue;
        if (!item.receiptJson || !item.zkVerifyTx || !item.acceptedAt
          || Date.parse(item.acceptedAt) < Date.parse(cohort.opensAt) || Date.parse(item.acceptedAt) >= Date.parse(cohort.closesAt)
          || !Number.isFinite(Date.parse(item.acceptedAt))) throw new AnonymousReviewError('Invalid platform review acceptance', 409);
        const proof = parseReviewProof(JSON.parse(item.proofJson)), signals = reviewPublicSignals(proof);
        if (proof.merkleTreeRoot !== cohort.root || proof.scope !== cohort.scope || proof.nullifier !== item.nullifier)
          throw new AnonymousReviewError('Review acceptance differs from the frozen cohort', 409);
        const statement = reviewStatement(config.vkHash, proof);
        if (!await horizenReceiptReader.verify(config, statement, JSON.parse(item.receiptJson), {
          blockNumber: Number(block.number), blockHash: block.hash })) throw new AnonymousReviewError('Accepted review lacks a finalized bridge receipt', 409);
        accepted.push({ nullifier: word(BigInt(signals[1]!)), messageHash: word(BigInt(signals[2]!)), statement });
      }
      accepted.sort((a, b) => BigInt(a.nullifier) < BigInt(b.nullifier) ? -1 : 1);
      const snapshot: TallySnapshot = { chainId: config.chainId, registry: config.bridge.toLowerCase(), groupId: cohort.id as Hex,
        scopeHash: word(scope), root: word(BigInt(cohort.root)), reviewVk: config.vkHash.toLowerCase() as Hex, closesAt,
        blockNumber: Number(block.number), blockHash: block.hash, blockTimestamp: Number(block.timestamp), accepted };
      tallyManifestHash(snapshot);
      return snapshot;
    }
    const [root, opens, closes, members] = await client.readContract({ address: config.contract, abi: anonymousReviewAbi,
      functionName: 'cohorts', args: [scope], blockNumber: block.number });
    if (root.toString() !== cohort.root || opens !== BigInt(Date.parse(cohort.opensAt) / 1000) || closes !== BigInt(closesAt)
      || members !== commitments.length) throw new AnonymousReviewError('Tally cohort differs from the registry', 409);
    // Locate the first possible acceptance block by timestamp; never rely on the local submission table for census.
    const firstBlockAt = async (timestamp: bigint) => {
      let low = BigInt(tally.deploymentBlock), high = block.number;
      while (low < high) {
        const middle = (low + high) / 2n;
        if ((await client.getBlock({ blockNumber: middle })).timestamp < timestamp) low = middle + 1n; else high = middle;
      }
      return low;
    };
    const first = await firstBlockAt(opens), last = (await firstBlockAt(closes)) - 1n;
    const accepted: AcceptedReview[] = [];
    const logsInRange = async (from: bigint, to: bigint): Promise<GetLogsReturnType<typeof event>> => {
      try { return await client.getLogs({ address: config.contract, event, args: { scopeHash: scope }, fromBlock: from, toBlock: to, strict: true }); }
      catch (error) {
        if (to - from < 500n || !/range|limit|too many|response size/i.test(String((error as Error).message))) throw error;
        const middle = (from + to) / 2n;
        return [...await logsInRange(from, middle), ...await logsInRange(middle + 1n, to)];
      }
    };
    for (let from = first; from <= last; from += 10_000n) {
      const end = from + 9_999n < last ? from + 9_999n : last;
      const logs = await logsInRange(from, end);
      for (const log of logs) {
        const args = log.args as { scopeHash: bigint; nullifier: bigint; messageHash: bigint; statement: Hex };
        if (log.removed || args.scopeHash !== scope) throw new AnonymousReviewError('Invalid finalized acceptance event', 503);
        accepted.push({ nullifier: word(args.nullifier), messageHash: word(args.messageHash), statement: args.statement.toLowerCase() as Hex });
      }
      if (accepted.length > 256) throw new AnonymousReviewError('Tally acceptance set exceeds the cohort limit', 409);
    }
    accepted.sort((a, b) => a.nullifier < b.nullifier ? -1 : a.nullifier > b.nullifier ? 1 : 0);
    const snapshot: TallySnapshot = { chainId: config.chainId, registry: config.contract.toLowerCase(), groupId: cohort.id as Hex,
      scopeHash: word(scope), root: word(root), reviewVk: config.vkHash.toLowerCase() as Hex, closesAt,
      blockNumber: Number(block.number), blockHash: block.hash, blockTimestamp: Number(block.timestamp), accepted };
    tallyManifestHash(snapshot);
    for (const item of accepted) {
      const key = await client.readContract({ address: config.contract, abi: [parseAbiItem('function reviewKey(uint256,uint256) pure returns(bytes32)')],
        functionName: 'reviewKey', args: [scope, BigInt(item.nullifier)], blockNumber: block.number });
      const stored = await client.readContract({ address: config.contract, abi: anonymousReviewAbi, functionName: 'accepted', args: [key], blockNumber: block.number });
      if (stored.toLowerCase() !== item.statement) throw new AnonymousReviewError('Acceptance event differs from registry storage', 409);
    }
    if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new AnonymousReviewError('Tally snapshot changed during collection', 503);
    return snapshot;
  }
  async complete(cohort: ReviewCohort, snapshot: TallySnapshot) {
    const key = `${tallyManifestHash(snapshot)}:${JSON.stringify([cohort.id, cohort.tutorId, cohort.period, cohort.scope,
      cohort.chainId, cohort.contract, cohort.root, cohort.opensAt, cohort.closesAt, cohort.membersJson])}`;
    if ((this.validated.get(key) || 0) > Date.now() - 60_000) return;
    const running = this.checking.get(key);
    if (running) return running;
    if (this.checking.size >= 2) throw new AnonymousReviewError('Tally census verifier is busy', 503);
    const check = (async () => {
      const canonical = await this.collect(cohort, snapshot);
      if (tallyManifestHash(canonical) !== tallyManifestHash(snapshot)) throw new AnonymousReviewError('Tally omitted or changed an accepted review', 409);
      if (this.validated.size >= 100) this.validated.clear();
      this.validated.set(key, Date.now());
    })();
    this.checking.set(key, check);
    try { await check; } finally { this.checking.delete(key); }
  }
  async receipt(statement: Hex, receipt: ReviewReceipt): Promise<boolean> {
    const config = await this.chain.check();
    if (config.infrastructure === 'bridge_only') return horizenReceiptReader.verify(config, statement, receipt);
    return this.client().readContract({ address: config.bridge,
      abi: [parseAbiItem('function verifyProofAggregation(uint256,uint256,bytes32,bytes32[],uint256,uint256) view returns(bool)')],
      functionName: 'verifyProofAggregation', args: [BigInt(config.domainId), BigInt(receipt.aggregationId), statement,
        receipt.merklePath as Hex[], BigInt(receipt.leafCount), BigInt(receipt.index)], blockTag: 'finalized' });
  }
}
