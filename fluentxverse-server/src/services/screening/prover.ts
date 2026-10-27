import { assertContributedGroth16Key } from '../proof.services/groth16KeySafety';
import { privacyInfrastructure, horizenVerificationNetwork } from '../proof.services/horizenReceipt';
import { assertCredentialCurrent } from './credential';
import { canonicalJson, decodeScreeningSignals, FIELD_MODULUS, policyHash, schemaHash } from './policy';

export interface EngineScreeningRelease {
  releaseManifestSHA256: string; vkHash: string; policyHash: string; schemaHash: string;
  issuerHash: string; issuerAx: string; issuerAy: string; chainId: number; domainId: number;
  bridge: string; agentId: string; verificationNetwork: string; cryptographicSetupVerified: boolean; vk: any;
  releasePolicy?: 'independent-reviewed' | 'self-operated'; independentlyReviewed?: boolean;
  independentContributors?: boolean; setupTrust?: string;
}

export async function screeningEngineRequest(path: string, body?: unknown, timeout = 10000): Promise<any> {
  const base = (process.env.GMR_SCREENING_ENGINE_API_BASE || '').replace(/\/$/, ''), key = process.env.GMR_SCREENING_ENGINE_API_KEY || '';
  if (!base || !key) throw Error('Dedicated screening proof project is not configured');
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal', 'gmr-engine', 'budol-gmr-engine-1'].includes(url.hostname)))) {
    throw Error('Private screening witnesses require HTTPS or an approved local Engine transport');
  }
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GMR-Engine-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout), redirect: 'error' });
  if (!response.ok) throw Error('Approved Engine screening prover is unavailable');
  if (!response.body) throw Error('Engine screening response is empty');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) { await reader.cancel(); throw Error('Engine screening response exceeds limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function approvedScreeningArtifacts(): Promise<EngineScreeningRelease> {
  privacyInfrastructure();
  if (process.env.SCREENING_ARTIFACTS_APPROVED !== 'true') throw Error('Screening artifacts require explicit production approval');
  const manifest = process.env.SCREENING_RELEASE_MANIFEST_SHA256 || '';
  if (!/^[a-f0-9]{64}$/.test(manifest)) throw Error('Reviewed Engine screening release pin required');
  const response = await screeningEngineRequest('/v1/screening/prover');
  const release = response?.release as EngineScreeningRelease;
  const chainId = Number(process.env.SCREENING_CHAIN_ID || '8453');
  const releasePolicy = process.env.SCREENING_RELEASE_POLICY || 'independent-reviewed';
  if (!['independent-reviewed', 'self-operated'].includes(releasePolicy)) throw Error('Unknown screening release policy');
  if (releasePolicy === 'self-operated' && (release?.releasePolicy !== 'self-operated'
    || release.independentlyReviewed !== false || release.independentContributors !== false)) {
    throw Error('Engine must disclose self-operated screening assurance');
  }
  if (releasePolicy === 'independent-reviewed' && release?.releasePolicy === 'self-operated') throw Error('Screening release policy downgrade');
  if (response.ready !== true || !release || release.cryptographicSetupVerified !== true
    || release.releaseManifestSHA256 !== manifest || release.policyHash !== policyHash || release.schemaHash !== schemaHash
    || release.issuerHash !== process.env.SCREENING_ISSUER_HASH || release.vkHash?.toLowerCase() !== process.env.SCREENING_ZKVERIFY_VK_HASH?.toLowerCase()
    || release.chainId !== chainId || release.domainId !== Number(process.env.SCREENING_ZKVERIFY_DOMAIN_ID)
    || release.bridge?.toLowerCase() !== process.env.SCREENING_RECEIPT_BRIDGE?.toLowerCase() || release.agentId !== '0'
    || release.verificationNetwork !== horizenVerificationNetwork(chainId)
    || [release.issuerAx, release.issuerAy].some(value => typeof value !== 'string' || !/^[1-9]\d{0,76}$/.test(value) || BigInt(value) >= FIELD_MODULUS)
    || release.vk?.protocol !== 'groth16' || release.vk?.curve !== 'bn128' || release.vk?.nPublic !== 15 || release.vk?.IC?.length !== 16) {
    throw Error('Engine screening release does not match approved application pins');
  }
  assertContributedGroth16Key(release.vk);
  return release;
}

export async function proveScreeningCredential(input: unknown, expectedSignals: string[]) {
  const signals = decodeScreeningSignals(expectedSignals);
  const release = await approvedScreeningArtifacts();
  assertCredentialCurrent(expectedSignals, { chainId: release.chainId, agentId: '0', adapterAddress: release.bridge }, release.issuerHash);
  if (signals.issuerAx !== release.issuerAx || signals.issuerAy !== release.issuerAy) throw Error('Screening issuer key differs from approved release');
  const result = await screeningEngineRequest('/v1/screening/proofs', { input, publicSignals: expectedSignals }, 200000);
  if (!result.proof || result.releaseManifestSHA256 !== release.releaseManifestSHA256
    || result.vkHash?.toLowerCase() !== release.vkHash.toLowerCase() || result.verificationNetwork !== release.verificationNetwork
    || canonicalJson(result.publicSignals) !== canonicalJson(expectedSignals)) throw Error('Engine screening proof statement changed');
  return { proof: result.proof, releaseManifestSHA256: release.releaseManifestSHA256, vkHash: release.vkHash.toLowerCase() };
}
