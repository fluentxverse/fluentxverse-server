import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi, type Hex } from 'viem';
import { AnonymousReviewError, reviewConfig, reviewGroth16, reviewPublicSignals, reviewStatement,
  reviewVerificationKey, semaphoreHash } from './policy';
import type { AnonymousReviewProof } from '../../shared/anonymousReviews';
import type { ReviewCohort } from './repository';
import { Group } from '@semaphore-protocol/group';
import { horizenReceiptReader, validateHorizenReceipt } from '../proof.services/horizenReceipt';
import { reviewGroupId, reviewScope } from './policy';
import { EngineProofReceiptClient } from '../web3.services/gmrProofReceipt.service';

export const anonymousReviewAbi = parseAbi([
  'function enabled() view returns (bool)', 'function bridge() view returns (address)',
  'function domainId() view returns (uint256)', 'function vkHash() view returns (bytes32)',
  'function proofDepth() view returns (uint256)', 'function minBatch() view returns (uint256)',
  'function cohorts(uint256) view returns (uint256 root, uint64 opensAt, uint64 closesAt, uint16 memberCount)',
  'function accepted(bytes32) view returns (bytes32)',
  'function registerCohort(uint256 scopeHash, uint256 root, uint64 opensAt, uint64 closesAt, uint16 memberCount)',
  'function acceptReview(uint256[4] signals, uint256 aggregationId, bytes32[] merklePath, uint256 leafCount, uint256 index)',
]);
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
  private async engine<T>(path: string, body: unknown, timeout = 30_000): Promise<T> {
    const base = (process.env.GMR_ANONYMOUS_REVIEWS_ENGINE_API_BASE || '').replace(/\/$/, '');
    const key = process.env.GMR_ANONYMOUS_REVIEWS_ENGINE_API_KEY || '';
    if (!base || !key) throw new AnonymousReviewError('Dedicated review Engine project is not configured', 503);
    const response = await fetch(`${base}/v1/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GMR-Engine-Key': key },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new AnonymousReviewError('Review Engine operation needs reconciliation', 503);
    return response.json() as Promise<T>;
  }
  private client() { return createPublicClient({ transport: http(reviewConfig().rpcUrl, { timeout: 15_000, retryCount: 0 }) }); }
  private async read(name: string, args: any[] = []) {
    const config = reviewConfig();
    return this.client().readContract({ address: config.contract, abi: anonymousReviewAbi, functionName: name as any, args, blockTag: 'finalized' } as any) as Promise<any>;
  }
  async check() {
    const config = reviewConfig(); reviewVerificationKey();
    if (config.infrastructure === 'bridge_only') { await horizenReceiptReader.check(config); return config; }
    if (await this.client().getChainId() !== config.chainId) throw new AnonymousReviewError('Wrong review RPC chain', 503);
    // Check trust roots on every read; unavailable verification never means valid.
    const bridge = await this.read('bridge'), domain = await this.read('domainId'), vk = await this.read('vkHash');
    if (bridge.toLowerCase() !== config.bridge.toLowerCase() || domain !== BigInt(config.domainId)
      || vk.toLowerCase() !== config.vkHash.toLowerCase() || await this.read('proofDepth') !== 8n
      || await this.read('minBatch') !== 5n || !await this.read('enabled'))
      throw new AnonymousReviewError('Unapproved or disabled review registry', 503);
    return config;
  }
  async active(cohort: ReviewCohort) {
    const config = await this.check();
    if (cohort.chainId !== config.chainId || cohort.contract.toLowerCase() !== config.contract.toLowerCase())
      throw new AnonymousReviewError('Wrong review deployment', 503);
    if (!cohort.root) return false;
    if (config.infrastructure === 'bridge_only') {
      const members: string[] = JSON.parse(cohort.membersJson || '[]');
      return cohort.activationStatus === 'active_bridge' && members.length >= 5 && members.length <= 256
        && new Set(members).size === members.length && new Group(members.map(BigInt)).root.toString() === cohort.root
        && cohort.id === reviewGroupId(cohort.tutorId, cohort.period)
        && cohort.scope === reviewScope(config.chainId, config.bridge, cohort.id);
    }
    const [root, opens, closes, count] = await this.read('cohorts', [BigInt(semaphoreHash(cohort.scope))]);
    return root.toString() === cohort.root && opens === BigInt(Date.parse(cohort.opensAt) / 1000)
      && closes === BigInt(Date.parse(cohort.closesAt) / 1000) && count === JSON.parse(cohort.membersJson || '[]').length;
  }
  async accepted(proof: AnonymousReviewProof, receiptJson?: string) {
    const config = await this.check();
    if (config.infrastructure === 'bridge_only') return receiptJson
      ? horizenReceiptReader.verify(config, reviewStatement(config.vkHash, proof), JSON.parse(receiptJson)) : false;
    const key = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }],
      [BigInt(semaphoreHash(proof.scope)), BigInt(proof.nullifier)]));
    return (await this.read('accepted', [key])).toLowerCase() === reviewStatement(config.vkHash, proof).toLowerCase();
  }
  private async write(functionName: string, args: unknown[]) {
    const config = await this.check();
    if (config.infrastructure === 'bridge_only') throw new AnonymousReviewError('Custom review contract writes are disabled', 409);
    const result = await this.engine<{ transaction: { id: string; status: string } }>('contracts/write', {
      abi: anonymousReviewAbi, args: args.map(value => typeof value === 'object' ? JSON.stringify(value) : String(value)),
      chainId: config.chainId, contractAddress: config.contract, functionName, value: '0', walletAddress: '' });
    if (!result.transaction?.id) throw new AnonymousReviewError('Engine returned no transaction', 503);
    return result.transaction;
  }
  async activate(cohort: ReviewCohort) {
    if (!cohort.root) throw new AnonymousReviewError('Seal the cohort first', 409);
    if (await this.active(cohort)) return { status: 'active' };
    return this.write('registerCohort', [semaphoreHash(cohort.scope), cohort.root, Date.parse(cohort.opensAt) / 1000,
      Date.parse(cohort.closesAt) / 1000, JSON.parse(cohort.membersJson || '[]').length]);
  }
  async submit(proof: AnonymousReviewProof) {
    const config = await this.check();
    const result = await this.engine<{ submission: { id: string; zkVerifyNetwork: string; transactionResult: string } }>('zkverify/proofs', {
      proof: reviewGroth16(proof), publicSignals: reviewPublicSignals(proof), vk: reviewVerificationKey(), domainId: config.domainId,
      proofSystem: 'groth16', curve: 'bn128', expectedNetwork: config.network }, 300_000);
    if (result.submission?.zkVerifyNetwork !== config.network) throw new AnonymousReviewError('Wrong review proof network', 503);
    const transaction = JSON.parse(result.submission.transactionResult);
    if (!/^0x[a-fA-F0-9]{64}$/.test(transaction.txHash || '') || transaction.statement?.toLowerCase() !== reviewStatement(config.vkHash, proof).toLowerCase())
      throw new AnonymousReviewError('Review proof submission requires reconciliation', 503);
    return { txHash: transaction.txHash as string, submissionId: result.submission.id };
  }
  async certify(proof: AnonymousReviewProof, receipt: ReviewReceipt) {
    validateReceipt(receipt);
    return this.write('acceptReview', [reviewPublicSignals(proof), receipt.aggregationId, receipt.merklePath, receipt.leafCount, receipt.index]);
  }
  async receipt(proof: AnonymousReviewProof, receipt: ReviewReceipt) {
    const config = await this.check();
    return horizenReceiptReader.verify(config, reviewStatement(config.vkHash, proof), receipt);
  }
}
