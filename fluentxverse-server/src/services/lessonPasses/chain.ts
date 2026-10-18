import { createPublicClient, http, parseAbi, type Hex } from 'viem';
import { reviewGroth16, semaphoreHash } from '../anonymousReviews/policy';
import { validateReceipt, type ReviewReceipt } from '../anonymousReviews/chain';
import { passConfig, passVerificationKey, passSignals, passStatement, PassError, parsePassProof } from './policy';
import type { StoredReservation } from './repository';

export const passAbi = parseAbi([
  'function owner() view returns(address)', 'function bridge() view returns(address)', 'function domainId() view returns(uint256)',
  'function vkHash() view returns(bytes32)', 'function scopeHash() view returns(uint256)', 'function enabled() view returns(bool)',
  'function batches(bytes32) view returns(uint256 root,uint16 count)',
  'function reservations(bytes32) view returns(uint256 nullifier,uint256 refundCommitment,uint8 state)',
  'function spent(uint256) view returns(bool)',
  'function registerBatch(bytes32,uint256,uint16)',
  'function reservePass(bytes32,uint256,uint64,uint256[4],uint256,bytes32[],uint256,uint256)',
  'function settlePass(bytes32)', 'function returnPass(bytes32)',
]);
export class LessonPassChain {
  client() { return createPublicClient({ transport: http(passConfig().rpcUrl, { timeout: 15_000, retryCount: 0 }) }); }
  async read(functionName: string, args: unknown[] = []) {
    return this.client().readContract({ address: passConfig().contract, abi: passAbi, functionName: functionName as any, args, blockTag: 'finalized' } as any) as Promise<any>;
  }
  async check() {
    const c = passConfig(); passVerificationKey();
    if (await this.client().getChainId() !== c.chainId || (await this.read('owner')).toLowerCase() !== c.issuer
      || (await this.read('bridge')).toLowerCase() !== c.bridge || await this.read('domainId') !== BigInt(c.domainId)
      || (await this.read('vkHash')).toLowerCase() !== c.vkHash || await this.read('scopeHash') !== BigInt(semaphoreHash(c.scope))
      || !await this.read('enabled')) throw new PassError('Pass ledger is not approved and finalized', 503);
    return c;
  }
  private async engine(path: string, body: unknown, timeout = 30_000): Promise<any> {
    const base = (process.env.GMR_LESSON_PASSES_ENGINE_API_BASE || '').replace(/\/$/, ''), key = process.env.GMR_LESSON_PASSES_ENGINE_API_KEY || '';
    if (!base || !key) throw new PassError('Dedicated pass Engine project is not configured', 503);
    const response = await fetch(`${base}/v1/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GMR-Engine-Key': key },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    if (!response.ok) throw new PassError('Pass operation needs Engine reconciliation; do not resubmit', 503);
    return response.json();
  }
  async write(functionName: string, args: unknown[]) {
    const c = await this.check();
    const { transaction } = await this.engine('contracts/write', { abi: passAbi, chainId: c.chainId, contractAddress: c.contract, functionName,
      args: args.map(value => typeof value === 'object' ? JSON.stringify(value) : String(value)), value: '0', walletAddress: '' });
    if (!transaction?.id) throw new PassError('Pass transaction needs reconciliation', 503);
    return { id: String(transaction.id), status: String(transaction.status) };
  }
  async activeBatch(id: Hex, root: string, count: number) {
    await this.check(); const [stored, size] = await this.read('batches', [id]);
    if (stored === 0n) return false;
    if (stored.toString() !== root || Number(size) !== count) throw new PassError('Pass batch differs from the ledger', 409);
    return true;
  }
  async submit(proof: ReturnType<typeof parsePassProof>) {
    const c = await this.check();
    const { submission } = await this.engine('zkverify/proofs', { proof: reviewGroth16(proof), publicSignals: passSignals(proof), vk: passVerificationKey(),
      domainId: c.domainId, proofSystem: 'groth16', curve: 'bn128', expectedNetwork: c.network }, 300_000);
    const result = JSON.parse(submission?.transactionResult || '{}');
    if (submission?.zkVerifyNetwork !== c.network || !submission.id || !/^0x[a-fA-F0-9]{64}$/.test(result.txHash || '')
      || result.statement?.toLowerCase() !== passStatement(proof)) throw new PassError('Pass proof submission needs reconciliation', 503);
    return { txHash: result.txHash as string, submissionId: submission.id as string };
  }
  async verifiedReceipt(reservation: StoredReservation, receipt: ReviewReceipt) {
    validateReceipt(receipt); const c = await this.check();
    if (!reservation.proofJson) throw new PassError('Pass proof is missing', 409);
    return this.client().readContract({ address: c.bridge,
      abi: parseAbi(['function verifyProofAggregation(uint256,uint256,bytes32,bytes32[],uint256,uint256) view returns(bool)']),
      functionName: 'verifyProofAggregation', args: [BigInt(c.domainId), BigInt(receipt.aggregationId), passStatement(parsePassProof(JSON.parse(reservation.proofJson))) as Hex,
        receipt.merklePath as Hex[], BigInt(receipt.leafCount), BigInt(receipt.index)], blockTag: 'finalized' });
  }
  async state(reservation: StoredReservation) {
    await this.check();
    const [nullifier, refundCommitment, state] = await this.read('reservations', [reservation.id]);
    if (Number(state) === 0) return 0;
    if (!reservation.nullifier || nullifier.toString() !== reservation.nullifier || refundCommitment.toString() !== reservation.refundCommitment)
      throw new PassError('Pass reservation differs from the finalized ledger', 409);
    return Number(state);
  }
  async reserve(reservation: StoredReservation, receipt: ReviewReceipt) {
    if (!await this.verifiedReceipt(reservation, receipt)) throw new PassError('Pass receipt is not finalized on Horizen', 409);
    const signals = passSignals(parsePassProof(JSON.parse(reservation.proofJson!)));
    return this.write('reservePass', [reservation.id, reservation.refundCommitment, reservation.deadline, signals,
      receipt.aggregationId, receipt.merklePath, receipt.leafCount, receipt.index]);
  }
  async expiredUnspent(reservation: StoredReservation) {
    const block = await this.client().getBlock({ blockTag: 'finalized' });
    if (block.timestamp <= BigInt(reservation.deadline) || await this.state(reservation) !== 0) return false;
    return !reservation.nullifier || !await this.read('spent', [BigInt(reservation.nullifier)]);
  }
}
