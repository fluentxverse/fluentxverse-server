import { concat, encodeAbiParameters, keccak256, parseAbi, sha256, toHex, type Address, type Hex } from 'viem';
import { gmrScreeningEngine } from '../web3.services/gmrScreeningEngine.service';
import { assertCredentialCurrent, type ScreeningBinding } from './credential';
import { FIELD_MODULUS, decodeScreeningSignals, type ScreeningSignals } from './policy';
import { assertHorizenReceiptConfig, horizenReceiptReader, privacyInfrastructure } from '../proof.services/horizenReceipt';
import { approvedScreeningArtifacts } from './prover';
import { readFileSync } from 'node:fs';

export const screeningValidatorAbi = parseAbi([
  'function certify(uint256[15] signals, uint256 aggregationId, bytes32[] merklePath, uint256 leafCount, uint256 index)',
  'function isCertified(uint256 commitment) view returns (bool)',
  'function revoke(uint256 commitment)',
  'function owner() view returns (address)',
  'function bridge() view returns (address)',
  'function registry() view returns (address)',
  'function domainId() view returns (uint256)',
  'function agentId() view returns (uint256)',
  'function vkHash() view returns (bytes32)',
  'function issuerHash() view returns (uint256)',
  'function policyHash() view returns (uint256)',
  'function schemaHash() view returns (uint256)',
]);
export const validationRegistryAbi = parseAbi([
  'function getIdentityRegistry() view returns (address)',
  'function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)',
  'function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)',
]);
export const identityRegistryAbi = parseAbi(['function register(string agentURI) returns (uint256)', 'function ownerOf(uint256 agentId) view returns (address)']);

export interface ScreeningChainConfig extends ScreeningBinding {
  validationRegistry: Address;
  identityRegistry: Address;
  bridge: Address;
  signer: Address;
  vkHash: Hex;
  issuerHash: string;
  domainId: number;
}
const address = (name: string): Address => {
  const value = process.env[name] || '';
  if (!/^0x[a-fA-F0-9]{40}$/.test(value) || BigInt(value) === 0n) throw new Error(`Configure ${name}`);
  return value as Address;
};
export function screeningChainConfig(): ScreeningChainConfig {
  const chainId = Number(process.env.SCREENING_CHAIN_ID || '2651420');
  if (![2651420, 26514].includes(chainId)) throw new Error('Screening must use an explicitly supported Horizen chain');
  const bridgeOnly = privacyInfrastructure() === 'bridge_only';
  const agentId = bridgeOnly ? '0' : process.env.SCREENING_AGENT_ID || '';
  const issuerHash = process.env.SCREENING_ISSUER_HASH || '';
  const vkHash = process.env.SCREENING_ZKVERIFY_VK_HASH || '';
  const domainId = Number(process.env.SCREENING_ZKVERIFY_DOMAIN_ID || '0');
  if (!/^(0|[1-9]\d*)$/.test(agentId) || BigInt(agentId) > BigInt(Number.MAX_SAFE_INTEGER)
    || !/^[1-9]\d*$/.test(issuerHash) || BigInt(issuerHash) >= FIELD_MODULUS || !/^0x[a-fA-F0-9]{64}$/.test(vkHash)
    || BigInt(vkHash) === 0n || !Number.isSafeInteger(domainId) || domainId <= 0) throw new Error('Screening trust configuration is incomplete');
  if (bridgeOnly) {
    const bridge = address('SCREENING_RECEIPT_BRIDGE'), rpcUrl = process.env.SCREENING_RPC_URL || '';
    assertHorizenReceiptConfig({ chainId, bridge, domainId, rpcUrl });
    const unused = '0x0000000000000000000000000000000000000000' as Address;
    return { chainId, agentId, issuerHash, vkHash: vkHash as Hex, domainId, adapterAddress: bridge,
      validationRegistry: unused, identityRegistry: unused, bridge, signer: unused };
  }
  return { chainId, agentId, issuerHash, vkHash: vkHash as Hex, domainId, adapterAddress: address('SCREENING_VALIDATOR_ADDRESS'),
    validationRegistry: address('SCREENING_VALIDATION_REGISTRY'), identityRegistry: address('SCREENING_IDENTITY_REGISTRY'), bridge: address('SCREENING_RECEIPT_BRIDGE'), signer: address('SCREENING_SIGNER_ADDRESS') };
}

export function encodeValidationPayload(config: ScreeningChainConfig, values: string[]): Hex {
  assertCredentialCurrent(values, config, config.issuerHash);
  return screeningPayloadBytes(config, values);
}
export function screeningPayloadBytes(config: ScreeningChainConfig, values: string[]): Hex {
  decodeScreeningSignals(values);
  const vector = values.map(BigInt) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
  return encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'uint256[15]' }],
    [BigInt(config.chainId), config.validationRegistry, config.adapterAddress as Address, BigInt(config.agentId), config.vkHash, vector]);
}

export function screeningLeaf(vkHash: Hex, values: string[]): Hex {
  decodeScreeningSignals(values);
  const encoded = values.map(value => `0x${BigInt(value).toString(16).padStart(64, '0').match(/../g)!.reverse().join('')}` as Hex);
  return keccak256(concat([keccak256(toHex('groth16')), vkHash, sha256(toHex('')), keccak256(concat(encoded))]));
}

export function validationResponseSummary(certified: boolean, signals: ScreeningSignals) {
  return { response: certified ? 100 : 0, meaning: 'Screening credential validation outcome, not an exam score',
    credentialCommitment: signals.credentialCommitment, policyHash: signals.policyHash, expiresAt: signals.expiresAt };
}

export async function assertValidatorConfiguration(config: ScreeningChainConfig, signals?: string[]) {
  if (signals) assertCredentialCurrent(signals, config, config.issuerHash);
  if (privacyInfrastructure() === 'bridge_only') {
    approvedScreeningArtifacts();
    await horizenReceiptReader.check({ ...config, rpcUrl: process.env.SCREENING_RPC_URL || '' });
    return;
  }
  const result = await gmrScreeningEngine.operation<{ checked: boolean; config: Record<string, unknown> }>('check', signals ? { publicSignals: signals } : {});
  if (!result.checked) throw new Error('Screening Engine did not confirm trust configuration');
  for (const [name, value] of Object.entries(config)) {
    if (String(result.config[name]).toLowerCase() !== String(value).toLowerCase()) throw new Error(`Screening Engine ${name} differs from credential configuration`);
  }
}

export async function readChainCertification(config: ScreeningChainConfig, values: string[], receiptJson?: string): Promise<boolean> {
  assertCredentialCurrent(values, config, config.issuerHash);
  await assertValidatorConfiguration(config, values);
  if (privacyInfrastructure() === 'bridge_only') return receiptJson
    ? horizenReceiptReader.verify({ ...config, rpcUrl: process.env.SCREENING_RPC_URL || '' }, screeningLeaf(config.vkHash, values), JSON.parse(receiptJson)) : false;
  const result = await gmrScreeningEngine.operation<{ certified: boolean; requestHash: string; statement: string }>('status', { publicSignals: values });
  if (result.requestHash !== keccak256(encodeValidationPayload(config, values)) || result.statement !== screeningLeaf(config.vkHash, values)) throw new Error('Screening Engine response is for another statement');
  return result.certified === true;
}

export async function submitBridgeScreeningProof(proof: unknown, values: string[]) {
  const config = screeningChainConfig();
  await assertValidatorConfiguration(config, values);
  const base = (process.env.GMR_SCREENING_ENGINE_API_BASE || '').replace(/\/$/, ''), key = process.env.GMR_SCREENING_ENGINE_API_KEY || '';
  if (!base || !key) throw new Error('Dedicated screening proof project is not configured');
  const response = await fetch(`${base}/v1/zkverify/proofs`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GMR-Engine-Key': key },
    body: JSON.stringify({ proof, publicSignals: values, vk: JSON.parse(readFileSync(process.env.SCREENING_VK_PATH!, 'utf8')),
      domainId: config.domainId, proofSystem: 'groth16', curve: 'bn128', expectedNetwork: 'Volta' }), signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error('Screening proof submission needs reconciliation');
  const result = await response.json() as { submission: { id: string; transactionResult: string; zkVerifyNetwork: string } };
  if (result.submission?.zkVerifyNetwork !== 'Volta' || !result.submission.id) throw new Error('Wrong screening proof network');
  return result;
}

export function agentRegistration(config?: Pick<ScreeningChainConfig, 'chainId' | 'agentId' | 'identityRegistry'>) {
  const api = 'https://api.fluentxverse.com/screening';
  if (privacyInfrastructure() === 'bridge_only') return {
    type: 'fluentxverse.screening-service.v1', name: 'FluentXVerse Tutor Screening',
    active: process.env.SCREENING_ENABLED === 'true', registrations: [],
    screening: { policy: `${api}/policy`, credentialVerification: `${api}/public/{commitment}`,
      validationMethod: 'Existing Horizen zkVerify receipt bridge; issuer-managed credentials and revocation',
      modelExecutionProven: false, privateEvidencePublished: false },
  };
  return { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: 'FluentXVerse Tutor Screening',
    description: 'Verifies privately held, approved issuer screening credentials. Does not prove AI accuracy or model execution.',
    services: [{ name: 'web', endpoint: `${api}/policy` }], active: process.env.SCREENING_ENABLED === 'true',
    supportedTrust: [],
    screening: { policy: `${api}/policy`, credentialVerification: `${api}/public/{commitment}`, validationMethod: 'zkVerify Groth16 aggregation receipt',
      modelExecutionProven: false, privateEvidencePublished: false },
    registrations: config ? [{ agentId: Number(config.agentId), agentRegistry: `eip155:${config.chainId}:${config.identityRegistry}` }] : [],
  };
}
