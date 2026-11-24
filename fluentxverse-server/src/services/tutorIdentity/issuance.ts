import { assertIdentityBinding, assertIdentityEligibility, assertIdentitySignals, type IdentityBinding, type IdentityEligibility } from './credential';
import type { HorizenReceipt } from '../proof.services/horizenReceipt';

export type IdentityIssuanceStage = 'ready' | 'proved' | 'submitting_proof' | 'proof_submitted' | 'proof_verified'
  | 'minting' | 'mint_submitted' | 'issued' | 'cancelled' | 'reconciliation_required' | 'revocation_required';
export interface IdentityProof {
  proof: unknown; publicSignals: string[]; verificationKeySHA256: string;
}
export interface IdentityIssuanceJob {
  id: string; stage: IdentityIssuanceStage; binding: IdentityBinding;
  issuer: { issuerAx: string; issuerAy: string }; verificationKeySHA256: string;
  proof?: IdentityProof; proofSubmissionId?: string; mintTransactionId?: string;
  mintTransactionHash?: string; tokenId?: string;
  nativeProofTransactionHash?: string;
  receiptStatus?: 'awaiting_zkverify_finality' | 'awaiting_aggregation' | 'awaiting_arbitrum_finality';
  arbitrumReceipt?: { chainId: 42161; domainId: 10; bridge: string; statement: string; receipt: HorizenReceipt;
    blockNumber: string; blockHash: string };
}
export function identityCredentialDisplayStatus(job:IdentityIssuanceJob) {
  const prefix=job.binding.mock?'test_credential_':'credential_';
  return prefix+(job.stage==='proof_submitted' && job.receiptStatus ? job.receiptStatus : job.stage);
}
export interface IdentityIssuanceGateway {
  prove(job: IdentityIssuanceJob, eligibility: IdentityEligibility): Promise<IdentityProof>;
  // A lost response is NOT permission to submit a second proof.
  submitProof(job: IdentityIssuanceJob): Promise<string>;
  verifyReceipt(job: IdentityIssuanceJob): Promise<boolean>;
  assertCollectionLocked(job: IdentityIssuanceJob): Promise<void>;
  // Must use a persistent Engine idempotency key, not /contracts/write without one.
  mint(job: IdentityIssuanceJob, idempotencyKey: string): Promise<string>;
  verifyMint(job: IdentityIssuanceJob): Promise<{ transactionHash: string } | null>;
}
export interface IdentityIssuanceRepository {
  // Must read current, not cached, applicant/identity/interview/wallet/consent facts.
  eligibility(job: IdentityIssuanceJob): Promise<IdentityEligibility>;
  save(job: IdentityIssuanceJob): Promise<void>;
}

// Call only while holding a durable per-job lease. This controller deliberately has
// no default live gateway: installing code alone must never authorize paid issuance.
export async function advanceIdentityIssuance(original: IdentityIssuanceJob, repository: IdentityIssuanceRepository, gateway: IdentityIssuanceGateway) {
  const job: IdentityIssuanceJob = structuredClone(original);
  if (['issued','cancelled','reconciliation_required','revocation_required'].includes(job.stage)) return job;
  if (['submitting_proof','minting'].includes(job.stage)) {
    job.stage = 'reconciliation_required'; await repository.save(job); return job;
  }
  assertIdentityBinding(job.binding);
  if (!/^[a-f0-9]{64}$/.test(job.verificationKeySHA256)) throw Error('Pinned identity verification key required');
  const eligibility = await repository.eligibility(job);
  try { assertIdentityEligibility(eligibility); }
  catch {
    job.stage = job.mintTransactionId ? 'revocation_required' : 'cancelled';
    await repository.save(job); return job;
  }
  const assertProof = () => {
    if (!job.proof || job.proof.verificationKeySHA256 !== job.verificationKeySHA256) throw Error('Identity proving release differs');
    assertIdentitySignals(job.proof.publicSignals, job.binding, job.issuer);
  };
  if (job.stage === 'ready') {
    job.proof = await gateway.prove(job, eligibility); assertProof();
    // The ERC-1155 token identifier is the bound credential commitment.
    job.tokenId = job.proof.publicSignals[7]; job.stage = 'proved';
  } else if (job.stage === 'proved') {
    assertProof(); await gateway.assertCollectionLocked(job);
    job.stage = 'submitting_proof'; await repository.save(job);
    try {
      job.proofSubmissionId = await gateway.submitProof(job);
      if (!job.proofSubmissionId) throw Error('Missing Engine proof reference');
      job.stage = 'proof_submitted';
    } catch {
      job.stage = 'reconciliation_required';
    }
  } else if (job.stage === 'proof_submitted') {
    assertProof();
    if (!job.proofSubmissionId) throw Error('Missing proof submission');
    if (await gateway.verifyReceipt(job)) job.stage = 'proof_verified';
  } else if (job.stage === 'proof_verified') {
    assertProof();
    // Recheck receipt and collection immediately before authorizing the mint.
    if (!job.proofSubmissionId || !(await gateway.verifyReceipt(job))) throw Error('Identity proof is not verified');
    await gateway.assertCollectionLocked(job);
    job.stage = 'minting'; await repository.save(job);
    try {
      job.mintTransactionId = await gateway.mint(job, `tutor-identity:${job.id}:${job.binding.chainId}:${job.binding.collection.toLowerCase()}`);
      if (!job.mintTransactionId) throw Error('Missing Engine mint reference');
      job.stage = 'mint_submitted';
    } catch {
      job.stage = 'reconciliation_required';
    }
  } else if (job.stage === 'mint_submitted') {
    assertProof();
    if (!job.mintTransactionId) throw Error('Missing mint transaction');
    const receipt = await gateway.verifyMint(job);
    if (receipt) {
      if (!/^0x[a-fA-F0-9]{64}$/.test(receipt.transactionHash)) throw Error('Invalid finalized mint hash');
      job.mintTransactionHash = receipt.transactionHash; job.stage = 'issued';
    }
  }
  await repository.save(job);
  return job;
}
