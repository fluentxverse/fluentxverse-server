import { Group } from '@semaphore-protocol/group';
import { keccak256, toHex } from 'viem';
import { REVIEW_DEPTH, REVIEW_MAX_MEMBERS, REVIEW_MIN_BATCH, reviewPeriod, reviewWindow, summarizeAnonymousReviews,
  validateAnonymousContent, type AnonymousReviewEnrollment, type AnonymousReviewGroup } from '../../shared/anonymousReviews';
import { AnonymousReviewError, canonicalInteger, parseReviewProof, requireAnonymousReviews, reviewConfig,
  reviewGroupId, reviewMessage, reviewScope, verifyReviewProof } from './policy';
import { AnonymousReviewRepository, type ReviewCohort } from './repository';
import { AnonymousReviewChain, validateReceipt, type ReviewReceipt } from './chain';
import { decryptReview, encryptReview } from './storage';
import { AnonymousReviewTally } from './tally';
import { ReviewTallySnapshotSource } from './tallySnapshot';
import { privacyInfrastructure } from '../proof.services/horizenReceipt';

export class AnonymousReviewService {
  constructor(public readonly repository = new AnonymousReviewRepository(), public readonly chain = new AnonymousReviewChain(),
    public readonly tally = new AnonymousReviewTally(repository, new ReviewTallySnapshotSource(chain, repository))) {}
  private enrollmentId(groupId: string, studentId: string) { return keccak256(toHex(JSON.stringify({ groupId, studentId }))); }
  private async eligibility(bookingId: string, studentId: string) {
    const { booking: b, legacyReviewed } = await this.repository.ownedBooking(bookingId, studentId);
    const start = b.slotDateTime?.toStandardDate ? b.slotDateTime.toStandardDate().toISOString() : String(b.slotDateTime);
    const ends = Date.parse(start) + (Number(b.durationMinutes) || 25) * 60_000;
    const period = reviewPeriod(start), window = reviewWindow(period), config = reviewConfig();
    const id = reviewGroupId(b.tutorId, period);
    const cohort: ReviewCohort = { id, tutorId: b.tutorId, period, ...window,
      scope: reviewScope(config.chainId, config.contract, id), chainId: config.chainId, contract: config.contract.toLowerCase() };
    const eligible = !legacyReviewed && b.status === 'completed' && b.attendanceStudent === 'present'
      && b.attendanceTutor === 'present' && ends <= Date.now() && Date.now() < Date.parse(window.opensAt);
    return { cohort, eligible, enrollmentId: this.enrollmentId(id, studentId) };
  }
  async forLesson(bookingId: string, studentId: string): Promise<AnonymousReviewEnrollment> {
    requireAnonymousReviews();
    const { cohort, eligible, enrollmentId } = await this.eligibility(bookingId, studentId);
    const enrollment = await this.repository.enrollment(enrollmentId);
    return { groupId: cohort.id, tutorId: cohort.tutorId, period: cohort.period, opensAt: cohort.opensAt, closesAt: cohort.closesAt,
      enrolled: Boolean(enrollment), commitment: enrollment?.commitment || null, canEnroll: eligible && !enrollment };
  }
  async enroll(bookingId: string, studentId: string, commitment: string) {
    requireAnonymousReviews(); canonicalInteger(commitment, undefined, true);
    const { cohort, eligible, enrollmentId } = await this.eligibility(bookingId, studentId);
    const old = await this.repository.enrollment(enrollmentId);
    if (!eligible && !old) throw new AnonymousReviewError('Enrollment requires a completed lesson with both participants marked present, before month end', 403);
    if (!old) await this.chain.check();
    await this.repository.enroll(cohort, enrollmentId, studentId, commitment);
    return this.forLesson(bookingId, studentId);
  }
  async mine(studentId: string) {
    requireAnonymousReviews();
    return (await this.repository.memberships(studentId)).map(({ cohort, commitment }) => ({ groupId: cohort.id, tutorId: cohort.tutorId,
      period: cohort.period, opensAt: cohort.opensAt, closesAt: cohort.closesAt, enrolled: true, commitment, canEnroll: false }));
  }
  async group(id: string): Promise<AnonymousReviewGroup> {
    requireAnonymousReviews(); const config = reviewConfig(), cohort = await this.repository.cohort(id);
    if (!cohort) throw new AnonymousReviewError('Review cohort not found', 404);
    const now = Date.now(), members: string[] = JSON.parse(cohort.membersJson || '[]');
    let state: AnonymousReviewGroup['state'] = now < Date.parse(cohort.opensAt) ? 'enrolling'
      : now >= Date.parse(cohort.closesAt) ? 'closed' : !cohort.root ? 'awaiting_activation'
      : members.length < REVIEW_MIN_BATCH ? 'insufficient_members' : 'awaiting_activation';
    if (state === 'awaiting_activation' && cohort.root && await this.chain.active(cohort)) state = 'open';
    if (state === 'awaiting_activation' && !cohort.root && await this.repository.memberCount(id) < REVIEW_MIN_BATCH) state = 'insufficient_members';
    // No growing membership snapshots: only the single frozen cohort is public.
    return { id: cohort.id, tutorId: cohort.tutorId, period: cohort.period, opensAt: cohort.opensAt, closesAt: cohort.closesAt,
      scope: cohort.scope, chainId: cohort.chainId, contract: cohort.contract,
      root: cohort.root || null, members, depth: REVIEW_DEPTH, state, artifacts: config.artifacts,
      infrastructure: config.infrastructure, acceptanceEnforcement: config.infrastructure === 'bridge_only' ? 'application' : 'contract' };
  }
  async activate(id: string) {
    requireAnonymousReviews();
    const cohort = await this.repository.seal(id, members => {
      if (members.length < REVIEW_MIN_BATCH || members.length > REVIEW_MAX_MEMBERS || new Set(members).size !== members.length)
        throw new AnonymousReviewError('At least five distinct eligible students must enroll', 409);
      const group = new Group(members.map(BigInt));
      return { root: group.root.toString(), membersJson: JSON.stringify(members) };
    });
    if (await this.chain.active(cohort)) return { status: 'active' };
    if (reviewConfig().infrastructure === 'bridge_only') {
      await this.chain.check(); await this.repository.activateBridge(id);
      return { status: 'active', infrastructure: 'bridge_only', enforcement: 'application' };
    }
    if (!await this.repository.claimActivation(id)) throw new AnonymousReviewError('Activation is pending or needs Engine reconciliation', 409);
    const transaction = await this.chain.activate(cohort);
    if ('id' in transaction) await this.repository.recordActivation(id, transaction.id);
    return transaction;
  }
  async receive(groupId: string, contentInput: unknown, proofInput: unknown) {
    requireAnonymousReviews();
    let content;
    try { content = validateAnonymousContent(contentInput); } catch (error) { throw new AnonymousReviewError((error as Error).message); }
    const proof = parseReviewProof(proofInput), group = await this.group(groupId);
    if (group.state !== 'open') throw new AnonymousReviewError('Review cohort is not open', 409);
    if (proof.merkleTreeRoot !== group.root || proof.scope !== group.scope || proof.message !== reviewMessage(groupId, content)
      || !await verifyReviewProof(proof)) throw new AnonymousReviewError('Review proof does not match this cohort and feedback');
    const id = keccak256(toHex(JSON.stringify({ scope: group.scope, nullifier: proof.nullifier })));
    const item = await this.repository.saveSubmission({ id, groupId, nullifier: proof.nullifier, proofJson: JSON.stringify(proof),
      encryptedContent: encryptReview(content, id), status: 'queued' });
    return { id: item.id, status: item.status, verified: false };
  }
  async submit(id: string) {
    requireAnonymousReviews();
    const existing = await this.repository.submission(id);
    if (!existing) throw new AnonymousReviewError('Review not found', 404);
    if (existing.zkVerifyTx) return { status: existing.status, txHash: existing.zkVerifyTx };
    const group = await this.group(existing.groupId);
    if (group.state !== 'open') throw new AnonymousReviewError('Review cohort is not open', 409);
    const item = await this.repository.claimSubmission(id);
    if (!item) throw new AnonymousReviewError('Submission is in progress or needs reconciliation; do not blindly retry', 409);
    const result = await this.chain.submit(parseReviewProof(JSON.parse(item.proofJson)));
    await this.repository.patch(id, { status: 'awaiting_horizen', zkVerifyTx: result.txHash, engineSubmissionId: result.submissionId });
    return { status: 'awaiting_horizen', txHash: result.txHash };
  }
  async certify(id: string, receipt: ReviewReceipt) {
    validateReceipt(receipt);
    requireAnonymousReviews(); const item = await this.repository.submission(id);
    if (!item?.zkVerifyTx) throw new AnonymousReviewError('Submit the review proof to zkVerify first', 409);
    const proof = parseReviewProof(JSON.parse(item.proofJson));
    if (await this.chain.accepted(proof, item.receiptJson)) return { status: 'verified', verified: true };
    if (reviewConfig().infrastructure === 'bridge_only') {
      const cohort = await this.repository.cohort(item.groupId);
      if (!cohort || !await this.chain.active(cohort) || proof.merkleTreeRoot !== cohort.root || proof.scope !== cohort.scope)
        throw new AnonymousReviewError('Review proof differs from the active cohort', 409);
      if (!await this.chain.receipt(proof, receipt)) throw new AnonymousReviewError('Review receipt is not finalized on Horizen', 409);
      await this.repository.acceptBridge(id, JSON.stringify(receipt));
      return { status: 'verified', verified: true, infrastructure: 'bridge_only', enforcement: 'application' };
    }
    if (!await this.repository.claimCertification(id)) throw new AnonymousReviewError('Certification is pending or needs Engine reconciliation', 409);
    const transaction = await this.chain.certify(proof, receipt);
    await this.repository.patch(id, { transactionId: transaction.id });
    return { transactionId: transaction.id, status: transaction.status, verified: false };
  }
  async reconcile(id: string) {
    requireAnonymousReviews();
    const config = reviewConfig(), item = await this.repository.submission(id);
    if (config.infrastructure !== 'bridge_only') throw new AnonymousReviewError('Automatic acceptance requires bridge-only mode', 409);
    if (!item?.engineSubmissionId || !item.zkVerifyTx) throw new AnonymousReviewError('Review requires a bound Engine submission; do not resubmit historical proofs', 409);
    const proof = parseReviewProof(JSON.parse(item.proofJson)), cohort = await this.repository.cohort(item.groupId);
    const members: string[] = JSON.parse(cohort?.membersJson || '[]');
    if (!cohort || cohort.activationStatus !== 'active_bridge' || cohort.chainId !== config.chainId || cohort.contract.toLowerCase() !== config.bridge.toLowerCase()
      || members.length < REVIEW_MIN_BATCH || members.length > REVIEW_MAX_MEMBERS || new Set(members).size !== members.length
      || new Group(members.map(BigInt)).root.toString() !== cohort.root || cohort.id !== reviewGroupId(cohort.tutorId, cohort.period)
      || cohort.scope !== reviewScope(config.chainId, config.bridge, cohort.id)
      || proof.merkleTreeRoot !== cohort.root || proof.scope !== cohort.scope) throw new AnonymousReviewError('Review differs from its approved cohort', 409);
    const result = await this.chain.reconcile(proof, item.engineSubmissionId);
    if (!result.verified) return { status: result.status, verified: false };
    if (!result.receipt) throw new AnonymousReviewError('Finalized receipt is missing', 503);
    if (item.status !== 'verified') await this.repository.acceptBridge(id, JSON.stringify(result.receipt));
    else if (item.receiptJson !== JSON.stringify(result.receipt)) throw new AnonymousReviewError('Review acceptance receipt differs', 409);
    return { status: 'verified', verified: true, infrastructure: 'bridge_only', enforcement: 'application' };
  }
  async status(id: string) {
    requireAnonymousReviews(); const item = await this.repository.submission(id);
    if (!item) throw new AnonymousReviewError('Review not found', 404);
    const verified = await this.chain.accepted(parseReviewProof(JSON.parse(item.proofJson)), item.receiptJson);
    return { id, status: verified ? 'verified' : item.status, verified };
  }
  async publish(groupId: string) {
    requireAnonymousReviews(); const cohort = await this.repository.cohort(groupId);
    if (!cohort) throw new AnonymousReviewError('Review cohort not found', 404);
    if (cohort.summaryJson) return this.summary(groupId);
    if (process.env.ANONYMOUS_REVIEW_TALLY_ENABLED === 'true') {
      await this.tally.publish(groupId); return this.summary(groupId);
    }
    if (Date.now() < Date.parse(cohort.closesAt)) throw new AnonymousReviewError('Publish only after the review window closes', 409);
    if (!await this.chain.active(cohort)) throw new AnonymousReviewError('Review cohort was not activated', 409);
    const contents = [];
    for (const item of await this.repository.submissions(groupId)) {
      const proof = parseReviewProof(JSON.parse(item.proofJson));
      if (!await this.chain.accepted(proof, item.receiptJson)) continue;
      const content = validateAnonymousContent(decryptReview(item.encryptedContent, item.id));
      if (proof.message !== reviewMessage(groupId, content)) throw new AnonymousReviewError('Stored feedback commitment differs', 409);
      contents.push(content);
    }
    if (contents.length < REVIEW_MIN_BATCH) throw new AnonymousReviewError('At least five chain-accepted reviews are required to publish', 409);
    await this.repository.saveSummary(groupId, JSON.stringify(summarizeAnonymousReviews(contents)));
    return this.summary(groupId);
  }
  async summary(groupId: string) {
    requireAnonymousReviews(); const cohort = await this.repository.cohort(groupId);
    if (!cohort) throw new AnonymousReviewError('Review cohort not found', 404);
    if (!cohort.summaryJson) return { groupId, period: cohort.period, tutorId: cohort.tutorId, status: 'unpublished' };
    if (!await this.chain.active(cohort)) throw new AnonymousReviewError('Review registry is unavailable', 503);
    const summary = JSON.parse(cohort.summaryJson);
    if (summary.tallyProtocol) {
      const evidence = await this.tally.publicEvidence(groupId);
      return { groupId, period: cohort.period, tutorId: cohort.tutorId, status: 'published', ...summary,
        tally: { status: 'verified', manifestHash: evidence.manifestHash, imageId: evidence.imageId, snapshotBlock: evidence.manifest.blockNumber,
          evidencePath: `tally/${groupId}` }, infrastructure: privacyInfrastructure(), verification: privacyInfrastructure() === 'bridge_only'
          ? 'ZK-proven totals for the platform-declared acceptance set, with finalized Horizen bridge receipts. Platform completeness is trusted.'
          : 'ZK-proven totals for the independently auditable finalized acceptance set.' };
    }
    return { groupId, period: cohort.period, tutorId: cohort.tutorId, status: 'published', ...JSON.parse(cohort.summaryJson),
      tally: { status: 'platform_calculated' },
      infrastructure: privacyInfrastructure(),
      verification: 'Each included review has a zkVerify-backed Horizen receipt; the platform computes this aggregate.' };
  }
  async tutorSummaries(tutorId: string) {
    if (process.env.ANONYMOUS_REVIEWS_ENABLED !== 'true') return { enabled: false, summaries: [] };
    const summaries = [];
    for (const id of await this.repository.publishedGroups(tutorId)) summaries.push(await this.summary(id));
    return { enabled: true, summaries };
  }
}
export const anonymousReviewService = new AnonymousReviewService();
