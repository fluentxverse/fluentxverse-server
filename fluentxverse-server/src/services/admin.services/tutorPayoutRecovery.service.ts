import { createHash } from 'node:crypto';
import { type ManagedTransaction } from 'neo4j-driver';
import { getDriver } from '../../db/memgraph';
import { plainNode } from '../../utils/adminOperations';
import { compensationTutorId, ensureCompensationSchema, TutorCompensationError } from './tutorCompensation.service';
import { earningsReason, finance, financialFailure, lockedBooking, lockTutor, payableCompletion, reservedPayoutEvidence } from './tutorEarnings.service';

export interface PayoutEnginePolicy {
  chainId: 8453 | 84532 | 26514 | 2651420;
  verificationNetwork: 'zkVerify' | 'Volta';
  releaseManifestSHA256: string;
  settlementPolicySHA256: string;
}
export interface PayoutIntent {
  protocol: 'fluentxverse.payout-intent.v1';
  operationId: string;
  submissionKey: string;
  batchId: string;
  tutorId: string;
  currency: 'USD';
  recipient: string;
  totalCents: number;
  reservationExpiresAt: string;
  earnings: { bookingId: string; rateVersion: number; netCents: number; completionAt: string }[];
  policy: PayoutEnginePolicy;
}
export interface PayoutObservation {
  submissionKey: string;
  intentHash: string;
  status: 'unknown' | 'pending' | 'settled' | 'reverted';
  engineTransactionId?: string;
  transactionHash?: string;
  chainId?: number;
  settlementEvidenceHash?: string;
}
// A future Engine adapter must enforce reviewed releases, conversion/asset policy,
// proof receipt validity and canonical settlement finality. No HTTP caller may
// supply this port or its observations. There is intentionally no live adapter yet.
export interface PayoutEnginePort {
  approvedPolicy(): Promise<PayoutEnginePolicy>;
  submit(intent: PayoutIntent, intentHash: string): Promise<PayoutObservation>;
  lookup(intent: PayoutIntent, intentHash: string): Promise<PayoutObservation>;
}
const unavailable = async (): Promise<never> => { throw new TutorCompensationError(503, 'Reviewed Engine payout execution is not available. Transfers remain disabled.'); };
const disabledEngine: PayoutEnginePort = { approvedPolicy: unavailable, submit: unavailable, lookup: unavailable };
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
const txHash = /^0x[0-9a-f]{64}$/i;
const terminal = (phase: string) => ['settled', 'cancelled', 'reverted'].includes(phase);

export function payoutEnginePolicy(policy: PayoutEnginePolicy) {
  if (!policy || !digest.test(policy.releaseManifestSHA256) || !digest.test(policy.settlementPolicySHA256)
    || !(([8453, 26514].includes(policy.chainId) && policy.verificationNetwork === 'zkVerify')
      || ([84532, 2651420].includes(policy.chainId) && policy.verificationNetwork === 'Volta'))) throw new TutorCompensationError(503, 'Approved payout release and matching networks are required.');
  return { chainId: policy.chainId, verificationNetwork: policy.verificationNetwork,
    releaseManifestSHA256: policy.releaseManifestSHA256, settlementPolicySHA256: policy.settlementPolicySHA256 };
}
export function payoutIntent(evidence: Awaited<ReturnType<typeof reservedPayoutEvidence>>, policy: PayoutEnginePolicy): PayoutIntent {
  const { batch, earnings } = evidence;
  return { protocol: 'fluentxverse.payout-intent.v1', operationId: `payout-${batch.id}`, submissionKey: `fxv-payout:${batch.id}`,
    batchId: batch.id, tutorId: batch.tutorId, currency: 'USD', recipient: batch.recipient, totalCents: batch.totalCents,
    reservationExpiresAt: batch.expiresAt, earnings: earnings.map(e => ({ bookingId: e.bookingId, rateVersion: e.rateVersion,
      netCents: e.netCents, completionAt: e.completionAt })).sort((a, b) => a.bookingId < b.bookingId ? -1 : a.bookingId > b.bookingId ? 1 : 0), policy: payoutEnginePolicy(policy) };
}
export function payoutReconciliationRequest(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0) {
    throw new TutorCompensationError(400, 'Reconciliation accepts no payment outcomes or transaction identifiers.');
  }
}
export function payoutObservation(intent: PayoutIntent, intentHash: string, observation: PayoutObservation) {
  if (!observation || observation.submissionKey !== intent.submissionKey || observation.intentHash !== intentHash
    || !['unknown', 'pending', 'settled', 'reverted'].includes(observation.status)
    || (observation.engineTransactionId !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(observation.engineTransactionId))
    || (observation.transactionHash !== undefined && !txHash.test(observation.transactionHash))
    || (observation.settlementEvidenceHash !== undefined && !txHash.test(observation.settlementEvidenceHash))
    || (observation.chainId !== undefined && observation.chainId !== intent.policy.chainId)) throw new TutorCompensationError(409, 'Engine payout outcome does not match the reserved intent.');
  if (['settled', 'reverted'].includes(observation.status) && (!observation.engineTransactionId || !observation.transactionHash
    || observation.chainId !== intent.policy.chainId || !txHash.test(observation.settlementEvidenceHash || ''))) {
    throw new TutorCompensationError(409, 'A verified final settlement outcome is required.');
  }
  return observation;
}
async function batchLocked(tx: ManagedTransaction, tutorId: string, id: string) {
  const row = (await tx.run(`MATCH (p:TutorPayoutBatch {id:$id,tutorId:$tutorId})
    SET p.writeRevision=coalesce(p.writeRevision,0)+1 RETURN p`, { id, tutorId })).records[0];
  if (!row) throw new TutorCompensationError(404, 'Tutor payout not found.');
  return plainNode(row.get('p').properties);
}
async function operationFor(tx: ManagedTransaction, batchId: string) {
  const rows = (await tx.run('MATCH (o:TutorPayoutOperation {batchId:$batchId}) RETURN o', { batchId })).records;
  if (rows.length > 1) throw new TutorCompensationError(409, 'Payout journal requires review.');
  return rows[0] ? plainNode(rows[0].get('o').properties) : null;
}
async function event(tx: ManagedTransaction, batchId: string, tutorId: string, actorId: string, action: string, reason: string, now: string, id: string = crypto.randomUUID()) {
  await tx.run(`MATCH (p:TutorPayoutBatch {id:$batchId,tutorId:$tutorId})
    CREATE (e:TutorPayoutEvent {id:$id,batchId:$batchId,tutorId:$tutorId,actorId:$actorId,action:$action,reason:$reason,at:$now})
    CREATE (p)-[:HAS_PAYOUT_EVENT]->(e)`, { id, batchId, tutorId, actorId, action, reason, now });
}
function historicalRisk(batch: Record<string, any>) {
  return batch.recoveryVersion !== 1 || Boolean(batch.engineTransactionId || batch.transactionHash || batch.transferTxId
    || batch.submittedAt || batch.dispatchStartedAt || batch.zkVerified || batch.transferEnabled);
}
function undispatched(operation: Record<string, any> | null) {
  return !operation || (operation.phase === 'prepared' && !operation.dispatchStartedAt && !operation.engineTransactionId
    && !operation.transactionHash && !operation.settlementEvidenceHash && !operation.dispatchCount);
}

export class TutorPayoutRecoveryService {
  constructor(private readonly engine: PayoutEnginePort = disabledEngine, private readonly clock = Date.now) {}

  private async transaction<T>(tutorId: string, id: string, actorId: string, fn: (tx: ManagedTransaction, batch: Record<string, any>) => Promise<T>) {
    compensationTutorId(tutorId); compensationTutorId(id); await ensureCompensationSchema();
    const session = getDriver().session();
    try {
      return await session.executeWrite(async tx => {
        await finance(tx, actorId); await lockTutor(tx, tutorId);
        return fn(tx, await batchLocked(tx, tutorId, id));
      });
    } catch (error) { return financialFailure(error); } finally { await session.close(); }
  }

  async list(tutorId: string, actorId: string) {
    compensationTutorId(tutorId); await ensureCompensationSchema(); const session = getDriver().session();
    try {
      return await session.executeRead(async tx => {
        await finance(tx, actorId);
        const rows = await tx.run(`MATCH (p:TutorPayoutBatch {tutorId:$tutorId})
          OPTIONAL MATCH (o:TutorPayoutOperation {batchId:p.id})
          RETURN p,o ORDER BY p.createdAt DESC,p.id DESC LIMIT 100`, { tutorId });
        return rows.records.map(row => {
          const batch = plainNode(row.get('p').properties), operation = row.get('o') ? plainNode(row.get('o').properties) : null;
          return this.view(batch, operation);
        });
      });
    } finally { await session.close(); }
  }

  async detail(tutorId: string, id: string, actorId: string) {
    return this.transaction(tutorId, id, actorId, async (tx, batch) => {
      const operation = await operationFor(tx, id);
      const rows = await tx.run('MATCH (e:TutorPayoutEvent {batchId:$id,tutorId:$tutorId}) RETURN e ORDER BY e.at DESC,e.id DESC LIMIT 100', { id, tutorId });
      return { ...this.view(batch, operation), events: rows.records.map(row => plainNode(row.get('e').properties)) };
    });
  }

  private view(batch: Record<string, any>, operation: Record<string, any> | null) {
    const { earningsJson, ...summary } = batch;
    const { intentJson, ...journal } = operation || {};
    return { batch: summary, operation: operation ? journal : null,
      canCancel: !historicalRisk(batch) && batch.status === 'reserved' && undispatched(operation),
      needsReconciliation: Boolean(operation && ['dispatching', 'submitted', 'review'].includes(operation.phase)),
      needsFinancialReview: historicalRisk(batch) || Boolean(batch.adjustmentRequired || (operation
        && (['review', 'reverted'].includes(operation.phase) || (operation.phase === 'prepared' && !undispatched(operation))))),
      transferEnabled: false };
  }

  async cancel(tutorId: string, id: string, actorId: string, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'reason,requestId'
      || !('requestId' in input) || typeof input.requestId !== 'string' || !uuid.test(input.requestId) || !('reason' in input)) {
      throw new TutorCompensationError(400, 'A cancellation request ID and reason are required.');
    }
    const requestId = input.requestId;
    const reason = earningsReason(input.reason);
    return this.transaction(tutorId, id, actorId, async (tx, batch) => {
      const old = (await tx.run('MATCH (e:TutorPayoutEvent {id:$id}) RETURN e', { id: requestId })).records[0]?.get('e').properties;
      if (old) {
        if (old.batchId !== id || old.tutorId !== tutorId || old.actorId !== actorId || old.action !== 'cancelled' || old.reason !== reason) throw new TutorCompensationError(409, 'Recovery request ID was already used.');
        return { batchId: id, status: 'cancelled', replayed: true, transferEnabled: false };
      }
      const operation = await operationFor(tx, id);
      if (historicalRisk(batch) || !['reserved', 'processing'].includes(batch.status)
        || !undispatched(operation)) {
        throw new TutorCompensationError(409, 'Submission may have occurred. Reconcile this payout before any release; do not resend.');
      }
      const ids = JSON.parse(batch.bookingIdsJson) as string[];
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length) throw new TutorCompensationError(409, 'Payout earning set requires review.');
      for (const bookingId of [...ids].sort()) {
        const b = await lockedBooking(tx, tutorId, compensationTutorId(bookingId), false);
        const raw = (await tx.run('MATCH (e:TutorEarning {bookingId:$bookingId,tutorId:$tutorId}) RETURN e', { bookingId, tutorId })).records[0]?.get('e').properties;
        if (!raw || raw.payoutBatchId !== id || raw.status !== 'reserved') throw new TutorCompensationError(409, 'Reservation ownership changed.');
        let status = 'unclaimed';
        try { payableCompletion(b, this.clock()); } catch { status = 'held'; }
        await tx.run(`MATCH (e:TutorEarning {bookingId:$bookingId,tutorId:$tutorId})
          SET e.status=$status,e.lastReleasedBatchId=$id REMOVE e.payoutBatchId`, { bookingId, tutorId, id, status });
      }
      const now = new Date(this.clock()).toISOString();
      await tx.run(`MATCH (p:TutorPayoutBatch {id:$id}) SET p.status='cancelled',p.cancelledAt=$now,p.cancelledBy=$actorId`, { id, now, actorId });
      if (operation) await tx.run("MATCH (o:TutorPayoutOperation {batchId:$id}) SET o.phase='cancelled',o.updatedAt=$now", { id, now });
      await event(tx, id, tutorId, actorId, 'cancelled', reason, now, requestId);
      return { batchId: id, status: 'cancelled', replayed: false, transferEnabled: false };
    });
  }

  // Internal worker entry point only. The default port fails closed. No route
  // exposes dispatch, arbitrary Engine IDs, outcomes, or a "mark paid" action.
  async process(tutorId: string, id: string, actorId: string) {
    const prior = await this.detail(tutorId, id, actorId);
    if (prior.operation && prior.operation.phase !== 'prepared') return this.reconcile(tutorId, id, actorId);
    const policy = payoutEnginePolicy(await this.engine.approvedPolicy());
    const prepared = await this.transaction(tutorId, id, actorId, async (tx, batch) => {
      if (historicalRisk(batch)) throw new TutorCompensationError(409, 'Historical payout requires review.');
      const existing = await operationFor(tx, id);
      if (existing) return existing;
      const evidence = await reservedPayoutEvidence(tx, tutorId, id, this.clock());
      const intent = payoutIntent(evidence, policy), intentHash = sha(intent), now = new Date(this.clock()).toISOString();
      const row = (await tx.run(`MATCH (p:TutorPayoutBatch {id:$id})
        CREATE (o:TutorPayoutOperation {id:$operationId,batchId:$id,tutorId:$tutorId,submissionKey:$key,
          intentHash:$hash,intentJson:$intent,phase:'prepared',dispatchCount:0,createdAt:$now,updatedAt:$now})
        CREATE (p)-[:HAS_PAYOUT_OPERATION]->(o) RETURN o`, { id, tutorId, operationId: intent.operationId, key: intent.submissionKey,
        hash: intentHash, intent: JSON.stringify(intent), now })).records[0];
      await event(tx, id, tutorId, actorId, 'prepared', 'Immutable payout intent recorded; no transfer submitted.', now);
      return plainNode(row!.get('o').properties);
    });
    if (prepared.phase !== 'prepared') return this.reconcile(tutorId, id, actorId);
    const claimed = await this.transaction(tutorId, id, actorId, async (tx) => {
      const operation = await operationFor(tx, id);
      if (!operation || operation.phase !== 'prepared') return null;
      if (!undispatched(operation)) throw new TutorCompensationError(409, 'Existing dispatch evidence prevents a new submission. Financial review is required.');
      const fresh = payoutIntent(await reservedPayoutEvidence(tx, tutorId, id, this.clock()), policy);
      if (sha(fresh) !== operation.intentHash || sha(JSON.parse(operation.intentJson)) !== operation.intentHash) throw new TutorCompensationError(409, 'Payout intent or release changed before dispatch.');
      const now = new Date(this.clock()).toISOString();
      await tx.run(`MATCH (o:TutorPayoutOperation {batchId:$id}),(p:TutorPayoutBatch {id:$id})
        SET o.phase='dispatching',o.dispatchCount=1,o.dispatchStartedAt=$now,o.updatedAt=$now,p.status='processing'`, { id, now });
      await event(tx, id, tutorId, actorId, 'dispatching', 'Dispatch claimed durably. Any interruption requires lookup, never automatic resubmission.', now);
      return operation;
    });
    if (!claimed) return this.reconcile(tutorId, id, actorId);
    const intent: PayoutIntent = JSON.parse(claimed.intentJson);
    let observation: PayoutObservation;
    try { observation = payoutObservation(intent, claimed.intentHash, await this.engine.submit(intent, claimed.intentHash)); }
    catch { return this.review(tutorId, id, actorId, 'Submission outcome is uncertain. Engine lookup is required; do not resend.'); }
    // Persistence failure here intentionally leaves the dispatch marker intact.
    return this.apply(tutorId, id, actorId, observation);
  }

  async reconcile(tutorId: string, id: string, actorId: string) {
    const operation = await this.transaction(tutorId, id, actorId, tx => operationFor(tx, id));
    if (!operation || operation.phase === 'prepared' || terminal(operation.phase)) return this.detail(tutorId, id, actorId);
    const intent: PayoutIntent = JSON.parse(operation.intentJson);
    let observation: PayoutObservation;
    try {
      if (sha(intent) !== operation.intentHash) throw Error('Intent changed');
      observation = payoutObservation(intent, operation.intentHash, await this.engine.lookup(intent, operation.intentHash));
    } catch { return this.review(tutorId, id, actorId, 'Engine outcome is unavailable or inconsistent. Keep earnings reserved; do not resend.'); }
    return this.apply(tutorId, id, actorId, observation);
  }

  private async review(tutorId: string, id: string, actorId: string, reason: string) {
    await this.transaction(tutorId, id, actorId, async (tx) => {
      const op = await operationFor(tx, id);
      if (!op || op.phase === 'prepared' || terminal(op.phase) || (op.phase === 'review' && op.reviewReason === reason)) return;
      const now = new Date(this.clock()).toISOString();
      await tx.run("MATCH (o:TutorPayoutOperation {batchId:$id}) SET o.phase='review',o.reviewReason=$reason,o.updatedAt=$now", { id, reason, now });
      await event(tx, id, tutorId, actorId, 'review', reason, now);
    });
    return this.detail(tutorId, id, actorId);
  }

  private async apply(tutorId: string, id: string, actorId: string, observation: PayoutObservation) {
    await this.transaction(tutorId, id, actorId, async (tx, batch) => {
      const op = await operationFor(tx, id);
      if (!op || op.phase === 'prepared' || op.phase === 'cancelled') throw new TutorCompensationError(409, 'No dispatched payout to reconcile.');
      const intent: PayoutIntent = JSON.parse(op.intentJson);
      if (sha(intent) !== op.intentHash) throw new TutorCompensationError(409, 'Payout intent changed.');
      payoutObservation(intent, op.intentHash, observation);
      if (terminal(op.phase)) {
        if (observation.status === 'settled' && (op.phase !== 'settled' || op.transactionHash?.toLowerCase() !== observation.transactionHash?.toLowerCase())) throw new TutorCompensationError(409, 'Conflicting final payout outcome requires review.');
        return;
      }
      if (op.engineTransactionId && observation.engineTransactionId && op.engineTransactionId !== observation.engineTransactionId) throw new TutorCompensationError(409, 'Engine payout identity changed.');
      const phase = observation.status === 'unknown' ? 'review' : observation.status === 'pending' ? 'submitted' : observation.status;
      const observationHash = sha(observation);
      if (op.observationHash === observationHash && op.phase === phase) return;
      const now = new Date(this.clock()).toISOString();
      if (phase === 'settled') {
        // Do not re-evaluate expired authorizations after settlement: an actual
        // payment still needs accounting. Flag later refunds/holds for review.
        let adjustmentRequired = false;
        for (const earning of intent.earnings) {
          const b = await lockedBooking(tx, tutorId, earning.bookingId, false);
          const raw = (await tx.run('MATCH (e:TutorEarning {bookingId:$bookingId,tutorId:$tutorId}) RETURN e', { bookingId: earning.bookingId, tutorId })).records[0]?.get('e').properties;
          const current = raw && plainNode(raw);
          if (!current || current.status !== 'reserved' || current.payoutBatchId !== id || current.netCents !== earning.netCents || current.rateVersion !== earning.rateVersion) throw new TutorCompensationError(409, 'Payout earning ownership changed; reconciliation requires review.');
          try { payableCompletion(b, this.clock()); } catch { adjustmentRequired = true; }
          await tx.run("MATCH (e:TutorEarning {bookingId:$bookingId}) SET e.status='paid',e.paidAt=$now,e.paidOperationId=$operationId", { bookingId: earning.bookingId, now, operationId: op.id });
        }
        if (batch.totalCents !== intent.totalCents || batch.recipient !== intent.recipient) throw new TutorCompensationError(409, 'Settled payout differs from its accounting record.');
        await tx.run(`MATCH (p:TutorPayoutBatch {id:$id}) SET p.status='paid',p.paidAt=$now,p.adjustmentRequired=$adjustment`, { id, now, adjustment: adjustmentRequired });
      }
      await tx.run(`MATCH (o:TutorPayoutOperation {batchId:$id})
        SET o.phase=$phase,o.updatedAt=$now,o.observationHash=$hash,o.engineTransactionId=coalesce($engineId,o.engineTransactionId),
          o.transactionHash=coalesce($txHash,o.transactionHash),o.settlementEvidenceHash=coalesce($evidenceHash,o.settlementEvidenceHash),
          o.settlementKey=coalesce($settlementKey,o.settlementKey),o.reviewReason=$reviewReason`,
      { id, phase, now, hash: observationHash, engineId: observation.engineTransactionId || null,
        txHash: observation.transactionHash || null, evidenceHash: observation.settlementEvidenceHash || null,
        settlementKey: phase === 'settled' ? `${intent.policy.chainId}:${observation.transactionHash!.toLowerCase()}` : null,
        reviewReason: phase === 'review' ? 'Engine has no definitive outcome. Reservation remains held.' : null });
      await event(tx, id, tutorId, actorId, phase, phase === 'review' ? 'Engine has no definitive outcome. Reservation remains held.' : 'Bound Engine payout outcome recorded.', now);
    });
    return this.detail(tutorId, id, actorId);
  }
}
export const tutorPayoutRecoveryService = new TutorPayoutRecoveryService();
