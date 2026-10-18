import { createPublicClient, http, parseAbi, type Address, type Hex } from 'viem';

export type PrivacyInfrastructure = 'bridge_only' | 'legacy_contracts';
export function privacyInfrastructure(): PrivacyInfrastructure {
  const mode = process.env.PRIVACY_INFRA_MODE || 'bridge_only';
  if (mode !== 'bridge_only' && mode !== 'legacy_contracts') throw new Error('Unknown privacy infrastructure mode');
  return mode;
}
export const HORIZEN_TESTNET_BRIDGE = '0x3098A6974649478f0133046e44105AA84e868C21' as Address;
export const HORIZEN_MAINNET_BRIDGE = '0xCb47A3C3B9Eb2E549a3F2EA4729De28CafbB2b69' as Address;
export function horizenVerificationNetwork(chainId: number): 'zkVerify' | 'Volta' {
  if (chainId === 26514) return 'zkVerify';
  if (chainId === 2651420) return 'Volta';
  throw new Error('Unsupported Horizen chain');
}
export interface HorizenReceipt { aggregationId: string; merklePath: string[]; leafCount: string; index: string }
export interface HorizenReceiptConfig { chainId: number; bridge: Address; domainId: number; rpcUrl: string }
export const receiptBridgeAbi = parseAbi([
  'function verifyProofAggregation(uint256,uint256,bytes32,bytes32[],uint256,uint256) view returns(bool)',
]);
export function validateHorizenReceipt(receipt: HorizenReceipt) {
  if (!receipt || Object.keys(receipt).some(k => !['aggregationId', 'merklePath', 'leafCount', 'index'].includes(k))
    || ![receipt.aggregationId, receipt.leafCount, receipt.index].every(value => typeof value === 'string')
    || !/^[1-9][0-9]{0,19}$/.test(receipt.aggregationId) || !/^[1-9][0-9]{0,19}$/.test(receipt.leafCount)
    || !/^(0|[1-9][0-9]{0,19})$/.test(receipt.index) || BigInt(receipt.index) >= BigInt(receipt.leafCount)
    || !Array.isArray(receipt.merklePath) || receipt.merklePath.length > 64
    || (BigInt(receipt.leafCount) === 1n) !== (receipt.merklePath.length === 0)
    || receipt.merklePath.some(item => typeof item !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(item)))
    throw new Error('Invalid Horizen aggregation receipt');
}
export function assertHorizenReceiptConfig(config: HorizenReceiptConfig) {
  const mainnet = config.chainId === 26514 && config.domainId === 3 && config.bridge.toLowerCase() === HORIZEN_MAINNET_BRIDGE.toLowerCase();
  const testnet = config.chainId === 2651420 && config.domainId === 175 && config.bridge.toLowerCase() === HORIZEN_TESTNET_BRIDGE.toLowerCase();
  if (!(mainnet || testnet) || !/^https?:\/\//.test(config.rpcUrl))
    throw new Error('Unapproved Horizen receipt configuration');
}
export class HorizenReceiptReader {
  constructor(private readonly clientFactory = (url: string) => createPublicClient({ transport: http(url, { timeout: 15_000, retryCount: 0 }) })) {}
  async check(config: HorizenReceiptConfig) {
    assertHorizenReceiptConfig(config);
    const client = this.clientFactory(config.rpcUrl);
    if (await client.getChainId() !== config.chainId) throw new Error('Wrong Horizen receipt RPC chain');
    const block = await client.getBlock({ blockTag: 'finalized' });
    if (!block.hash || block.number === null) throw new Error('Horizen finality unavailable');
    const code = await client.getBytecode({ address: config.bridge, blockNumber: block.number });
    if (!code || code === '0x') throw new Error('Official Horizen receipt bridge is unavailable');
    return block;
  }
  async verify(config: HorizenReceiptConfig, statement: Hex, receipt: HorizenReceipt,
    at?: { blockNumber: number; blockHash: Hex }) {
    validateHorizenReceipt(receipt);
    if (!/^0x[a-fA-F0-9]{64}$/.test(statement) || BigInt(statement) === 0n) throw new Error('Invalid proof statement');
    const finalized = await this.check(config), client = this.clientFactory(config.rpcUrl);
    if (at && (!Number.isSafeInteger(at.blockNumber) || at.blockNumber < 0 || !/^0x[a-fA-F0-9]{64}$/.test(at.blockHash)))
      throw new Error('Invalid receipt snapshot');
    const block = at ? await client.getBlock({ blockNumber: BigInt(at.blockNumber) }) : finalized;
    if (block.number > finalized.number || (at && block.hash !== at.blockHash)) throw new Error('Receipt snapshot is not canonical and finalized');
    const verified = await client.readContract({ address: config.bridge, abi: receiptBridgeAbi, functionName: 'verifyProofAggregation',
      args: [BigInt(config.domainId), BigInt(receipt.aggregationId), statement, receipt.merklePath as Hex[], BigInt(receipt.leafCount), BigInt(receipt.index)],
      blockNumber: block.number });
    if ((await client.getBlock({ blockNumber: block.number })).hash !== block.hash) throw new Error('Receipt snapshot changed');
    return verified === true;
  }
}
export const horizenReceiptReader = new HorizenReceiptReader();
