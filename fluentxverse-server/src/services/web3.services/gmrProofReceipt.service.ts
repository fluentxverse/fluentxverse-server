import { finalizedDestinationReceipt, horizenVerificationNetwork, receiptDestinationName, validateHorizenReceipt, type HorizenReceipt } from '../proof.services/horizenReceipt';

export interface EngineReceiptBinding { network: 'zkVerify' | 'Volta'; chainId: number; domainId: number; bridge: string; statement: string }
export class EngineProofReceiptClient {
  constructor(private readonly namespace: 'GMR_ANONYMOUS_REVIEWS' | 'GMR_LESSON_PASSES' | 'GMR_ANONYMOUS_TALLY') {}
  async reconcile(submissionId: string, expected: EngineReceiptBinding): Promise<{ verified: boolean; status: string; receipt?: HorizenReceipt }> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)) throw Error('A bound Engine proof submission is required');
    if (expected.network !== horizenVerificationNetwork(expected.chainId)) throw Error('Wrong verification network for destination');
    const destination = receiptDestinationName(expected.chainId);
    const base = (process.env[`${this.namespace}_ENGINE_API_BASE`] || '').replace(/\/$/, ''), key = process.env[`${this.namespace}_ENGINE_API_KEY`] || '';
    if (!base || !key) throw Error('Configure the dedicated proof Engine connection');
    const response = await fetch(`${base}/v1/zkverify/proofs/${submissionId}/receipt`, {
      headers: { 'X-GMR-Engine-Key': key }, signal: AbortSignal.timeout(240_000),
    });
    if (!response.ok) throw Error('Engine receipt reconciliation unavailable; do not resubmit the proof');
    const result = await response.json() as any, r = result.receipt;
    if (result.submissionId !== submissionId || !r || r.network !== expected.network || r.chainId !== expected.chainId || r.domainId !== expected.domainId
      || typeof r.bridge !== 'string' || r.bridge.toLowerCase() !== expected.bridge.toLowerCase()
      || typeof r.statement !== 'string' || r.statement.toLowerCase() !== expected.statement.toLowerCase() || r.verifiedOnZkVerify !== true) throw Error('Engine receipt binding differs');
    if (['awaiting_aggregation', `awaiting_${destination}_relay_or_finality`].includes(r.status)) {
      if (['verifiedOnBase', 'verifiedOnArbitrum', 'verifiedOnHorizen', 'verifiedOnDestination'].some(k => r[k] === true))
        throw Error('Pending receipt claims destination finality');
      return { verified: false, status: r.status };
    }
    if (!finalizedDestinationReceipt(r, expected.chainId) || !/^(0|[1-9][0-9]*)$/.test(r[`${destination}Block`] || '')
      || !/^0x[a-fA-F0-9]{64}$/.test(r[`${destination}BlockHash`] || '')) throw Error('Engine receipt is not finalized');
    validateHorizenReceipt(r.receipt);
    return { verified: true, status: r.status, receipt: r.receipt };
  }
}
