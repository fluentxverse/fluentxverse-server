import { createPublicClient, http, type Hex } from 'viem';
import { Group } from '@semaphore-protocol/group';
import { AnonymousReviewChain, type ReviewReceipt } from './chain';
import { AnonymousReviewError, reviewConfig, reviewGroupId, reviewScope, semaphoreHash,
  parseReviewProof, reviewPublicSignals, reviewStatement } from './policy';
import { AnonymousReviewRepository, type ReviewCohort } from './repository';
import { horizenReceiptReader, type HorizenReceipt } from '../proof.services/horizenReceipt';
import { tallyConfig, tallyManifestHash, word, type AcceptedReview, type TallySnapshot } from './tallyPolicy';

export class ReviewTallySnapshotSource {
  private readonly validated = new Map<string, number>();
  private readonly checking = new Map<string, Promise<void>>();
  constructor(private readonly chain = new AnonymousReviewChain(), private readonly repository = new AnonymousReviewRepository()) {}
  private client() { return createPublicClient({ transport: http(reviewConfig().rpcUrl, { timeout: 15_000, retryCount: 0 }) }); }
  async collect(cohort: ReviewCohort, at?: { blockNumber: number; blockHash: Hex }): Promise<TallySnapshot> {
    const config = await this.chain.check(), client = this.client();
    tallyConfig();
    if (!cohort.root || cohort.chainId !== config.chainId || cohort.contract.toLowerCase() !== config.bridge.toLowerCase())
      throw new AnonymousReviewError('Wrong tally review deployment', 409);
    const commitments: string[] = JSON.parse(cohort.membersJson || '[]');
    if (cohort.id !== reviewGroupId(cohort.tutorId, cohort.period) || cohort.scope !== reviewScope(config.chainId, config.bridge, cohort.id)
      || commitments.length < 5 || commitments.length > 256 || new Set(commitments).size !== commitments.length
      || new Group(commitments.map(BigInt)).root.toString() !== cohort.root)
      throw new AnonymousReviewError('Invalid tally cohort binding or membership root', 409);
    const finalized = await client.getBlock({ blockTag: 'finalized' });
    const block = at ? await client.getBlock({ blockNumber: BigInt(at.blockNumber) }) : finalized;
    if (!block.hash || block.number === null || block.number > finalized.number || (at && block.hash !== at.blockHash))
      throw new AnonymousReviewError('Tally snapshot is not canonical and finalized', 409);
    const closesAt = Date.parse(cohort.closesAt) / 1000;
    if (!Number.isSafeInteger(closesAt) || block.timestamp < BigInt(closesAt)) throw new AnonymousReviewError('Wait for finalized review window closure', 409);
    if (!await this.chain.active(cohort)) throw new AnonymousReviewError('Bridge-only cohort is inactive', 409);
    const accepted: AcceptedReview[] = [];
    const receipts: { statement: Hex; receipt: HorizenReceipt }[] = [];
    for (const item of await this.repository.submissions(cohort.id)) {
      if (item.status !== 'verified') continue;
      if (!item.receiptJson || !item.zkVerifyTx || !item.acceptedAt
        || Date.parse(item.acceptedAt) < Date.parse(cohort.opensAt) || Date.parse(item.acceptedAt) >= Date.parse(cohort.closesAt)
        || !Number.isFinite(Date.parse(item.acceptedAt))) throw new AnonymousReviewError('Invalid platform review acceptance', 409);
      const proof = parseReviewProof(JSON.parse(item.proofJson)), signals = reviewPublicSignals(proof);
      if (proof.merkleTreeRoot !== cohort.root || proof.scope !== cohort.scope || proof.nullifier !== item.nullifier)
        throw new AnonymousReviewError('Review acceptance differs from the frozen cohort', 409);
      const statement = reviewStatement(config.vkHash, proof);
      receipts.push({ statement, receipt: JSON.parse(item.receiptJson) });
      accepted.push({ nullifier: word(BigInt(signals[1]!)), messageHash: word(BigInt(signals[2]!)), statement });
    }
    const verified = await horizenReceiptReader.verifyBatch(config, receipts, { blockNumber: Number(block.number), blockHash: block.hash });
    if (verified.some(result => result !== true) || verified.length !== receipts.length)
      throw new AnonymousReviewError('Accepted review lacks a finalized bridge receipt', 409);
    accepted.sort((a, b) => BigInt(a.nullifier) < BigInt(b.nullifier) ? -1 : BigInt(a.nullifier) > BigInt(b.nullifier) ? 1 : 0);
    const snapshot: TallySnapshot = { chainId: config.chainId, registry: config.bridge.toLowerCase(), groupId: cohort.id as Hex,
      scopeHash: word(BigInt(semaphoreHash(cohort.scope))), root: word(BigInt(cohort.root)), reviewVk: config.vkHash.toLowerCase() as Hex, closesAt,
      blockNumber: Number(block.number), blockHash: block.hash, blockTimestamp: Number(block.timestamp), accepted };
    tallyManifestHash(snapshot);
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
    return horizenReceiptReader.verify(config, statement, receipt);
  }
}
