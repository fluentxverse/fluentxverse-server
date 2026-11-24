import { createPublicClient, decodeEventLog, encodeFunctionData, http, parseAbi, type Abi, type Address, type Hex } from 'viem';
import pin from '../../../../shared/tutorRewardsDeployment.json';
import artifact from '../../../../shared/tutorRewardsArtifact.json';
import { rewardAddress, RewardError } from './policy';

export { pin };
export const rewardsAbi = artifact.abi as Abi;
export const settlementAbi = parseAbi(['function decimals() view returns(uint8)', 'function balanceOf(address) view returns(uint256)',
  'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)']);
export const rewardsClient = createPublicClient({ transport: http(pin.rpcUrl, { timeout: 15_000, retryCount: 0 }) });
const target = { address: rewardAddress(pin.contract), abi: rewardsAbi };
interface EngineRewardResponse {
  signature?: `0x${string}`;
  digest?: `0x${string}`;
  transaction?: { id: string; appId: string; chainId: number; contractAddress: string; walletAddress: string;
    method: string; args: string[]; value: string; status: string; transactionHash?: string | null };
}
export const jsonSafe = (value: unknown) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));

export function matchesRewardsRuntime(code: string | undefined) {
  return matchesContractRuntime(code, artifact);
}
export function matchesContractRuntime(code: string | undefined, compiled: { runtime: string; immutableReferences: Record<string, { start: number; length: number }[]> }) {
  if (!code) return false;
  const mask = (value: string) => {
    const bytes = Buffer.from(value.replace(/^0x/, ''), 'hex');
    for (const refs of Object.values(compiled.immutableReferences)) for (const ref of refs) bytes.fill(0, ref.start, ref.start + ref.length);
    return bytes.toString('hex');
  };
  return code.length === compiled.runtime.length && mask(code) === mask(compiled.runtime);
}

export class RewardsGateway {
  constructor(readonly client: any = rewardsClient, readonly fetcher: typeof fetch = fetch) {}
  configured() {
    return Boolean(process.env.TUTOR_REWARDS_ENGINE_API_BASE && process.env.TUTOR_REWARDS_ENGINE_API_KEY);
  }
  async chain() {
    if (await this.client.getChainId() !== pin.chainId) throw new RewardError(503, 'Reward RPC returned the wrong network.');
  }
  async read(functionName: string, args: unknown[] = [], blockNumber?: bigint): Promise<any> {
    return this.client.readContract({ ...target, functionName, args, ...(blockNumber === undefined ? {} : { blockNumber }) });
  }
  async status() {
    await this.chain();
    const [code, gas] = await Promise.all([this.client.getCode({ address: target.address }), this.client.getBalance({ address: pin.operator })]);
    const base = { operatorGasWei: String(gas), deployed: false, finalized: false, claimsPaused: true, allocationsPaused: true,
      maxQuoteAgeSeconds: 300, treasuryUsd: '0', reservedUsd: '0', surplusUsd: '0' };
    if (!code || code === '0x') return base;
    if (!matchesRewardsRuntime(code)) throw new RewardError(503, 'Unexpected code at the planned rewards address.');
    const [owner, engine, relayer, guardian, settlement, claimsPaused, allocationsPaused, maxQuoteAgeSeconds, reserve, balance, final] = await Promise.all([
      ...['owner', 'engine', 'claimRelayer', 'guardian', 'settlementToken', 'claimsPaused', 'allocationsPaused', 'maxQuoteAgeSeconds', 'reservedUsd'].map(fn => this.read(fn)),
      this.client.readContract({ address: rewardAddress(pin.settlementToken), abi: settlementAbi, functionName: 'balanceOf', args: [target.address] }),
      this.client.getBlock({ blockTag: 'finalized' }),
    ]);
    if ([owner, engine, relayer, guardian].some(a => a.toLowerCase() !== pin.operator) || settlement.toLowerCase() !== pin.settlementToken) {
      throw new RewardError(503, 'Rewards deployment roles or settlement binding changed.');
    }
    const receipt = await this.client.getTransactionReceipt({ hash: pin.deploymentTransaction as Hex });
    const deploymentBlock = await this.client.getBlock({ blockNumber: receipt.blockNumber });
    if (receipt.status !== 'success' || receipt.contractAddress?.toLowerCase() !== pin.contract || deploymentBlock.hash !== receipt.blockHash) {
      throw new RewardError(503, 'Rewards deployment receipt is invalid or noncanonical.');
    }
    // This non-upgradeable contract's canonical creation receipt establishes deployment finality.
    // Public Robinhood RPCs need not retain account state at older finalized block heights.
    return { ...base, deployed: true, finalized: receipt.blockNumber <= final.number, claimsPaused, allocationsPaused,
      maxQuoteAgeSeconds: Number(maxQuoteAgeSeconds), treasuryUsd: String(balance), reservedUsd: String(reserve),
      surplusUsd: String(balance > reserve ? balance - reserve : 0n) };
  }
  async assertWritable() {
    if (!this.configured()) throw new RewardError(503, 'Rewards Engine connection has not been configured.');
    const status = await this.status();
    if (!status.deployed) throw new RewardError(409, 'Rewards contract has not been deployed on Robinhood Chain.');
    if (!status.finalized) throw new RewardError(409, 'Rewards deployment is awaiting network finality.');
    if (BigInt(status.operatorGasWei) === 0n) throw new RewardError(409, 'Fund the Engine wallet with ETH on Robinhood Chain.');
    return status;
  }
  async request(path: string, body?: unknown): Promise<EngineRewardResponse> {
    const base = process.env.TUTOR_REWARDS_ENGINE_API_BASE;
    const key = process.env.TUTOR_REWARDS_ENGINE_API_KEY;
    if (!base || !key) throw new RewardError(503, 'Rewards Engine connection is unavailable.');
    let response: Response;
    try { response = await this.fetcher(base.replace(/\/$/, '') + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-GMR-Engine-Key': key, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) }); }
    catch { throw new RewardError(503, 'Engine response is uncertain. Retry the same request; do not create a replacement.'); }
    if (!response.ok) throw new RewardError(503, 'Engine could not accept the reward operation. No completion is claimed.');
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new RewardError(503, 'Engine returned an invalid reward response.');
    return payload as EngineRewardResponse;
  }
  async submit(id: string, method: string, args: any[], settlement = false, replay = false) {
    const address = rewardAddress(settlement ? pin.settlementToken : pin.contract), abi = settlement ? settlementAbi : rewardsAbi;
    return this.submitContract(id, address, abi, method, args, replay);
  }
  async submitContract(id: string, address: Address, abi: Abi, method: string, args: any[], replay = false) {
    // Simulate exact calldata before queueing. The Engine still estimates fees and owns the signing key.
    if (!replay) await this.client.simulateContract({ address, abi, functionName: method, args, account: rewardAddress(pin.operator) });
    const data = encodeFunctionData({ abi, functionName: method, args });
    const payload = { idempotencyKey: `tutor-rewards:${pin.chainId}:${pin.contract}:${id}`, chainId: pin.chainId,
      walletAddress: pin.operator, contractAddress: address, kind: 'contract_write', method,
      args: args.map(v => typeof v === 'object' ? JSON.stringify(jsonSafe(v)) : String(v)), value: '0', metadata: { abi, source: 'tutor_rewards', data } };
    const response = await this.request('/v1/transactions', payload);
    if (typeof response.transaction?.id !== 'string' || !response.transaction.id) throw new RewardError(503, 'Engine returned no transaction reference.');
    return response.transaction.id as string;
  }
  async operation(id: string, method: string, args: any[], settlement = false) {
    return this.contractOperation(id, rewardAddress(settlement ? pin.settlementToken : pin.contract), settlement ? settlementAbi : rewardsAbi, method, args);
  }
  async contractOperation(id: string, address: Address, abi: Abi, method: string, args: any[]) {
    const response = await this.request('/v1/transactions/' + encodeURIComponent(id));
    const t = response.transaction;
    const expectedArgs = args.map(v => typeof v === 'object' ? JSON.stringify(jsonSafe(v)) : String(v));
    if (!t || t.id !== id || t.appId !== pin.projectId || t.chainId !== pin.chainId || t.contractAddress?.toLowerCase() !== address
      || t.walletAddress?.toLowerCase() !== pin.operator || t.method !== method || JSON.stringify(t.args) !== JSON.stringify(expectedArgs)
      || BigInt(t.value || 0) !== 0n) throw new RewardError(503, 'Rewards transaction binding does not match.');
    const result = { status: t.status === 'failed' ? 'review_required' : 'queued', transactionHash: t.transactionHash || null };
    if (!/^0x[0-9a-f]{64}$/i.test(t.transactionHash || '')) return result;
    const receipt = await this.client.getTransactionReceipt({ hash: t.transactionHash as Hex }).catch((e: any) => {
      if (e.name === 'TransactionReceiptNotFoundError') return null;
      throw e;
    });
    if (!receipt) return { ...result, status: 'submitted' };
    const tx = await this.client.getTransaction({ hash: t.transactionHash });
    if (tx.from.toLowerCase() !== pin.operator || tx.to?.toLowerCase() !== address || tx.value !== 0n
      || tx.input.toLowerCase() !== encodeFunctionData({ abi, functionName: method, args }).toLowerCase()) {
      throw new RewardError(503, 'Onchain reward transaction differs from its approved operation.');
    }
    if (receipt.status !== 'success') return { ...result, status: 'review_required' };
    const [block, finalized] = await Promise.all([this.client.getBlock({ blockNumber: receipt.blockNumber }), this.client.getBlock({ blockTag: 'finalized' })]);
    if (block.hash !== receipt.blockHash) return { ...result, status: 'review_required' };
    return { ...result, status: receipt.blockNumber <= finalized.number ? 'finalized' : 'confirming' };
  }
  async assetAddresses() {
    const rows = await this.client.getLogs({ address: target.address, event: rewardsAbi.find((v: any) => v.type === 'event' && v.name === 'AssetConfigured'), fromBlock: 0n, toBlock: 'latest' });
    return [...new Set<string>(rows.map((r: any) => r.args.token.toLowerCase()))];
  }
}

export const rewardsGateway = new RewardsGateway();
