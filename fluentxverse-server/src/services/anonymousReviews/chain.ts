import { Group } from '@semaphore-protocol/group';
import { AnonymousReviewError, reviewConfig, reviewGroth16, reviewPublicSignals, reviewStatement,
  reviewVerificationKey, reviewGroupId, reviewScope } from './policy';
import type { AnonymousReviewProof } from '../../shared/anonymousReviews';
import type { ReviewCohort } from './repository';
import { horizenReceiptReader, validateHorizenReceipt } from '../proof.services/horizenReceipt';
import { EngineProofReceiptClient } from '../web3.services/gmrProofReceipt.service';

export interface ReviewReceipt { aggregationId: string; merklePath: string[]; leafCount: string; index: string }
export function validateReceipt(receipt: ReviewReceipt) {
  try { validateHorizenReceipt(receipt); }
  catch { throw new AnonymousReviewError('Invalid aggregation receipt'); }
}
export class AnonymousReviewChain {
  async reconcile(proof: AnonymousReviewProof, submissionId: string) {
    const config = reviewConfig();
    return new EngineProofReceiptClient('GMR_ANONYMOUS_REVIEWS').reconcile(submissionId, { ...config, statement: reviewStatement(config.vkHash, proof) });
  }
  async check() {
    const config = reviewConfig();
    reviewVerificationKey();
    await horizenReceiptReader.check(config);
    return config;
  }
  async active(cohort: ReviewCohort) {
    const config = await this.check();
    if (cohort.chainId !== config.chainId || cohort.contract.toLowerCase() !== config.bridge.toLowerCase()) return false;
    if (!cohort.root) return false;
    const members: string[] = JSON.parse(cohort.membersJson || '[]');
    return cohort.activationStatus === 'active_bridge' && members.length >= 5 && members.length <= 256
      && new Set(members).size === members.length && new Group(members.map(BigInt)).root.toString() === cohort.root
      && cohort.id === reviewGroupId(cohort.tutorId, cohort.period)
      && cohort.scope === reviewScope(config.chainId, config.bridge, cohort.id);
  }
  async accepted(proof: AnonymousReviewProof, receiptJson?: string) {
    const config = await this.check();
    return receiptJson ? horizenReceiptReader.verify(config, reviewStatement(config.vkHash, proof), JSON.parse(receiptJson)) : false;
  }
  async submit(proof: AnonymousReviewProof) {
    const config = await this.check();
    const base = (process.env.GMR_ANONYMOUS_REVIEWS_ENGINE_API_BASE || '').replace(/\/$/, '');
    const key = process.env.GMR_ANONYMOUS_REVIEWS_ENGINE_API_KEY || '';
    if (!base || !key) throw new AnonymousReviewError('Dedicated review proof project is not configured', 503);
    const response = await fetch(`${base}/v1/zkverify/proofs`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GMR-Engine-Key': key },
      body: JSON.stringify({ proof: reviewGroth16(proof), publicSignals: reviewPublicSignals(proof), vk: reviewVerificationKey(),
        domainId: config.domainId, proofSystem: 'groth16', curve: 'bn128', expectedNetwork: config.network }),
      signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new AnonymousReviewError('Review proof needs Engine reconciliation; do not blindly retry', 503);
    const result = await response.json() as { submission: { id: string; zkVerifyNetwork: string; transactionResult: string } };
    if (result.submission?.zkVerifyNetwork !== config.network || !result.submission.id) throw new AnonymousReviewError('Wrong review proof network', 503);
    const transaction = JSON.parse(result.submission.transactionResult);
    if (!/^0x[a-fA-F0-9]{64}$/.test(transaction.txHash || '') || transaction.statement?.toLowerCase() !== reviewStatement(config.vkHash, proof).toLowerCase())
      throw new AnonymousReviewError('Review proof submission requires reconciliation', 503);
    return { txHash: transaction.txHash as string, submissionId: result.submission.id };
  }
  async activate(_cohort: ReviewCohort): Promise<{ id: string; status: string }> {
    throw new AnonymousReviewError('Custom review contract writes are archived; activation is application-managed', 410);
  }
  async certify(_proof: AnonymousReviewProof, _receipt: ReviewReceipt): Promise<{ id: string; status: string }> {
    throw new AnonymousReviewError('Custom review contract writes are archived and disabled', 410);
  }
  async receipt(proof: AnonymousReviewProof, receipt: ReviewReceipt) {
    validateReceipt(receipt);
    const config = await this.check();
    return horizenReceiptReader.verify(config, reviewStatement(config.vkHash, proof), receipt);
  }
}
