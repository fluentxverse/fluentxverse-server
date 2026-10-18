import { type Hex } from 'viem';
import { REVIEW_MIN_BATCH, validateAnonymousContent } from '../../shared/anonymousReviews';
import { AnonymousReviewError, parseReviewProof, requireAnonymousReviews, reviewMessage, reviewPublicSignals } from './policy';
import { privacyInfrastructure } from '../proof.services/horizenReceipt';
import { AnonymousReviewRepository, type ReviewCohort, type ReviewTallyRecord } from './repository';
import { decryptReview, encryptReview } from './storage';
import { validateReceipt, type ReviewReceipt } from './chain';
import { tallyConfig, parseTallyProof, tallyJournal, tallyManifestHash, tallyStatement, tallySummary, tallyTotals, word,
  type TallyProof, type TallySnapshot, type TallyTotals, type TallyWitness } from './tallyPolicy';
import { ReviewTallySnapshotSource } from './tallySnapshot';
import { ReviewTallyProver } from './tallyProver';

export class AnonymousReviewTally {
  constructor(readonly repository = new AnonymousReviewRepository(), readonly source = new ReviewTallySnapshotSource(), readonly prover = new ReviewTallyProver()) {}
  private async cohort(id: string) {
    requireAnonymousReviews(); tallyConfig();
    const cohort = await this.repository.cohort(id);
    if (!cohort) throw new AnonymousReviewError('Review cohort not found', 404);
    if (Date.now() < Date.parse(cohort.closesAt)) throw new AnonymousReviewError('Publish only after the review window closes', 409);
    return cohort;
  }
  private async record(id: string) {
    const record = await this.repository.tally(id);
    if (!record) throw new AnonymousReviewError('Prepare the tally snapshot first', 409);
    return record;
  }
  async prepare(id: string) {
    const cohort = await this.cohort(id), old = await this.repository.tally(id);
    if (old) return { status: old.status, manifestHash: tallyManifestHash(JSON.parse(old.manifestJson)) };
    if (cohort.summaryJson) throw new AnonymousReviewError('Historical platform aggregates cannot be relabeled as proven', 409);
    const snapshot = await this.source.collect(cohort);
    if (snapshot.accepted.length > tallyConfig().maxReviews) throw new AnonymousReviewError('Full acceptance set exceeds the configured prover capacity; do not publish a subset', 409);
    if (snapshot.accepted.length < REVIEW_MIN_BATCH) throw new AnonymousReviewError('At least five finalized accepted reviews are required', 409);
    const submissions = await this.repository.submissions(id), contents = [];
    for (const entry of snapshot.accepted) {
      const matches = submissions.filter(item => word(BigInt(item.nullifier)) === entry.nullifier);
      if (matches.length !== 1) throw new AnonymousReviewError('Accepted review is missing its private content; partial publication is forbidden', 409);
      const item = matches[0]!, proof = parseReviewProof(JSON.parse(item.proofJson));
      const content = validateAnonymousContent(decryptReview(item.encryptedContent, item.id));
      const signals = reviewPublicSignals(proof);
      if (proof.nullifier !== item.nullifier || proof.message !== reviewMessage(id, content)
        || word(BigInt(signals[0]!)) !== snapshot.root || word(BigInt(signals[1]!)) !== entry.nullifier
        || word(BigInt(signals[2]!)) !== entry.messageHash || word(BigInt(signals[3]!)) !== snapshot.scopeHash)
        throw new AnonymousReviewError('Stored review differs from the accepted commitment', 409);
      contents.push(content);
    }
    const totals = tallyTotals(contents), journal = tallyJournal(snapshot, totals);
    const record = await this.repository.saveTally({ id, status: 'prepared', manifestJson: JSON.stringify(snapshot), totalsJson: JSON.stringify(totals),
      journal, encryptedWitness: encryptReview({ snapshot, contents }, `tally:${id}`) });
    return { status: record.status, manifestHash: tallyManifestHash(snapshot) };
  }
  async prove(id: string) {
    await this.cohort(id);
    const record = await this.repository.claimTally(id, ['prepared', 'proof_failed'], 'proving');
    if (!record) throw new AnonymousReviewError('Tally proving is already in progress or complete', 409);
    try {
      const witness = decryptReview(record.encryptedWitness, `tally:${id}`) as TallyWitness;
      if (JSON.stringify(witness.snapshot) !== record.manifestJson) throw new AnonymousReviewError('Private tally snapshot changed', 409);
      const proof = await this.prover.prove(witness);
      if (proof.publicSignals !== record.journal) throw new AnonymousReviewError('Proved tally differs from its immutable snapshot', 409);
      await this.repository.patchTally(id, { status: 'proof_ready', proofJson: JSON.stringify(proof), imageId: proof.vk });
      return { status: 'proof_ready', imageId: proof.vk };
    } catch (error) { await this.repository.patchTally(id, { status: 'proof_failed' }); throw error; }
  }
  async submit(id: string) {
    const cohort = await this.cohort(id), config = tallyConfig(), record = await this.record(id);
    if (record.zkVerifyTx) return { status: record.status, txHash: record.zkVerifyTx };
    if (!record.proofJson) throw new AnonymousReviewError('Generate the tally proof first', 409);
    const proof = parseTallyProof(JSON.parse(record.proofJson));
    await this.prover.verify(proof);
    if (proof.publicSignals !== record.journal) throw new AnonymousReviewError('Tally journal changed', 409);
    await this.source.complete(cohort, JSON.parse(record.manifestJson));
    const base = (process.env.GMR_ANONYMOUS_TALLY_ENGINE_API_BASE || '').replace(/\/$/, ''), key = process.env.GMR_ANONYMOUS_TALLY_ENGINE_API_KEY || '';
    if (!base || !key) throw new AnonymousReviewError('Dedicated tally Engine project is not configured', 503);
    if (!await this.repository.claimTally(id, ['proof_ready'], 'submitting_zkverify')) throw new AnonymousReviewError('Tally submission needs reconciliation; do not blindly retry', 409);
    const response = await fetch(`${base}/v1/zkverify/proofs`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GMR-Engine-Key': key },
      body: JSON.stringify({ proof: proof.proof, publicSignals: proof.publicSignals, vk: config.imageId, proofSystem: 'risc0', version: 'V2_3',
        domainId: Number(process.env.ANONYMOUS_REVIEWS_DOMAIN_ID), expectedNetwork: 'Volta' }), signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new AnonymousReviewError('Tally submission needs Engine reconciliation', 503);
    const { submission } = await response.json() as any, transaction = JSON.parse(submission?.transactionResult || '{}');
    if (submission?.zkVerifyNetwork !== 'Volta' || !submission?.id || !/^0x[a-fA-F0-9]{64}$/.test(transaction.txHash || '')
      || transaction.statement?.toLowerCase() !== tallyStatement(config.imageId, record.journal as Hex))
      throw new AnonymousReviewError('Tally proof statement needs reconciliation', 503);
    await this.repository.patchTally(id, { status: 'awaiting_horizen', zkVerifyTx: transaction.txHash, engineSubmissionId: submission.id });
    return { status: 'awaiting_horizen', txHash: transaction.txHash };
  }
  private async validate(cohort: ReviewCohort, record: ReviewTallyRecord, receipt: ReviewReceipt) {
    validateReceipt(receipt); const config = tallyConfig();
    if (!record.zkVerifyTx || !record.proofJson || record.imageId !== config.imageId) throw new AnonymousReviewError('Submit the approved tally proof first', 409);
    const snapshot = JSON.parse(record.manifestJson) as TallySnapshot, totals = JSON.parse(record.totalsJson) as TallyTotals;
    const proof = parseTallyProof(JSON.parse(record.proofJson));
    if (tallyJournal(snapshot, totals) !== record.journal || proof.publicSignals !== record.journal || proof.vk !== config.imageId)
      throw new AnonymousReviewError('Tally totals differ from the proof journal', 409);
    await this.source.complete(cohort, snapshot);
    const statement = tallyStatement(config.imageId, record.journal as Hex);
    if (!await this.source.receipt(statement, receipt)) throw new AnonymousReviewError('Tally receipt is not verified at Horizen finality', 409);
    return { snapshot, totals, statement };
  }
  async certify(id: string, receipt: ReviewReceipt) {
    const cohort = await this.cohort(id), record = await this.record(id);
    await this.validate(cohort, record, receipt);
    if (record.receiptJson && record.receiptJson !== JSON.stringify(receipt)) throw new AnonymousReviewError('Tally receipt is immutable', 409);
    await this.repository.certifyTally(id, JSON.stringify(receipt));
    return { status: 'certified' };
  }
  async publish(id: string) {
    const cohort = await this.cohort(id), record = await this.record(id);
    if (!record.receiptJson) throw new AnonymousReviewError('Certify the tally proof before publishing', 409);
    const { totals } = await this.validate(cohort, record, JSON.parse(record.receiptJson));
    const summary = { ...tallySummary(totals), tallyProtocol: 'fluentxverse.review-tally.v1' };
    if (cohort.summaryJson && JSON.stringify(JSON.parse(cohort.summaryJson)) !== JSON.stringify(summary))
      throw new AnonymousReviewError('Published review summary is immutable', 409);
    await this.repository.saveSummary(id, JSON.stringify(summary));
    return { status: 'published' };
  }
  async publicEvidence(id: string) {
    const cohort = await this.cohort(id), record = await this.record(id);
    if (!cohort.summaryJson || !record.receiptJson) throw new AnonymousReviewError('Proven tally is not published', 404);
    const { snapshot, totals, statement } = await this.validate(cohort, record, JSON.parse(record.receiptJson));
    const expected = { ...tallySummary(totals), tallyProtocol: 'fluentxverse.review-tally.v1' };
    if (JSON.stringify(JSON.parse(cohort.summaryJson)) !== JSON.stringify(expected)) throw new AnonymousReviewError('Published tally changed', 503);
    const config = tallyConfig();
    return { protocol: 'fluentxverse.review-tally.v1', manifest: snapshot, manifestHash: tallyManifestHash(snapshot), totals, journal: record.journal,
      cohort: { id: cohort.id, tutorId: cohort.tutorId, period: cohort.period, scope: cohort.scope, chainId: cohort.chainId, contract: cohort.contract,
        root: cohort.root, membersJson: cohort.membersJson, opensAt: cohort.opensAt, closesAt: cohort.closesAt },
      imageId: config.imageId, proof: parseTallyProof(JSON.parse(record.proofJson!)), statement, zkVerifyTx: record.zkVerifyTx,
      receipt: JSON.parse(record.receiptJson), verified: true,
      completeness: privacyInfrastructure() === 'bridge_only'
        ? 'All platform-recorded accepted reviews for this closed cohort. Each proof has a finalized Horizen receipt; eligibility, acceptance and dataset completeness remain platform assertions.'
        : 'All finalized ReviewAccepted events for this closed cohort; independently auditable via the source RPC, not a ZK light-client proof.',
      acceptanceSource: privacyInfrastructure() === 'bridge_only' ? 'platform' : 'contract' };
  }
}
