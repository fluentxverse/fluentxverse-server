import { concat, encodeAbiParameters, keccak256, sha256, toHex, type Address, type Hex } from 'viem';
import { assertCredentialCurrent, type ScreeningBinding } from './credential';
import { FIELD_MODULUS, decodeScreeningSignals, type ScreeningSignals } from './policy';
import { assertHorizenReceiptConfig, horizenReceiptReader, privacyInfrastructure, horizenVerificationNetwork } from '../proof.services/horizenReceipt';
import { approvedScreeningArtifacts, screeningEngineRequest } from './prover';

export interface ScreeningChainConfig extends ScreeningBinding {
  validationRegistry: Address; identityRegistry: Address; bridge: Address; signer: Address;
  vkHash: Hex; issuerHash: string; domainId: number;
}
export function screeningChainConfig(): ScreeningChainConfig {
  privacyInfrastructure();
  const chainId = Number(process.env.SCREENING_CHAIN_ID || '8453');
  const issuerHash = process.env.SCREENING_ISSUER_HASH || '', vkHash = process.env.SCREENING_ZKVERIFY_VK_HASH || '';
  const domainId = Number(process.env.SCREENING_ZKVERIFY_DOMAIN_ID || '0');
  if (!/^[1-9]\d*$/.test(issuerHash) || BigInt(issuerHash) >= FIELD_MODULUS || !/^0x[a-fA-F0-9]{64}$/.test(vkHash)
    || BigInt(vkHash) === 0n || !Number.isSafeInteger(domainId) || domainId <= 0) throw new Error('Screening trust configuration is incomplete');
  const bridge = (process.env.SCREENING_RECEIPT_BRIDGE || '') as Address, rpcUrl = process.env.SCREENING_RPC_URL || '';
  assertHorizenReceiptConfig({ chainId, bridge, domainId, rpcUrl });
  const unused = '0x0000000000000000000000000000000000000000' as Address;
  return { chainId, agentId: '0', issuerHash, vkHash: vkHash as Hex, domainId, adapterAddress: bridge,
    validationRegistry: unused, identityRegistry: unused, bridge, signer: unused };
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
  const release = await approvedScreeningArtifacts();
  await horizenReceiptReader.check({ ...config, rpcUrl: process.env.SCREENING_RPC_URL || '' });
  return release;
}
export async function readChainCertification(config: ScreeningChainConfig, values: string[], receiptJson?: string): Promise<boolean> {
  assertCredentialCurrent(values, config, config.issuerHash);
  await assertValidatorConfiguration(config, values);
  return receiptJson ? horizenReceiptReader.verify({ ...config, rpcUrl: process.env.SCREENING_RPC_URL || '' },
    screeningLeaf(config.vkHash, values), JSON.parse(receiptJson)) : false;
}
export async function submitBridgeScreeningProof(proof: unknown, values: string[]) {
  const config = screeningChainConfig();
  const release = await assertValidatorConfiguration(config, values);
  const network = horizenVerificationNetwork(config.chainId);
  let result: { submission: { id: string; transactionResult: string; zkVerifyNetwork: string } };
  try {
    result = await screeningEngineRequest('/v1/zkverify/proofs', { proof, publicSignals: values, vk: release.vk,
      domainId: config.domainId, proofSystem: 'groth16', curve: 'bn128', expectedNetwork: network }, 300000);
  } catch { throw new Error('Screening proof submission needs reconciliation'); }
  if (result.submission?.zkVerifyNetwork !== network || !result.submission.id) throw new Error('Wrong screening proof network');
  return result;
}
export function agentRegistration(_config?: Pick<ScreeningChainConfig, 'chainId' | 'agentId' | 'identityRegistry'>) {
  const api = 'https://api.fluentxverse.com/screening';
  return { type: 'fluentxverse.screening-service.v1', name: 'FluentXVerse Tutor Screening',
    active: process.env.SCREENING_ENABLED === 'true', registrations: [],
    screening: { policy: `${api}/policy`, credentialVerification: `${api}/public/{commitment}`,
      validationMethod: 'Official zkVerify receipt bridge on the configured chain; issuer-managed credentials and revocation',
      modelExecutionProven: false, privateEvidencePublished: false },
  };
}
