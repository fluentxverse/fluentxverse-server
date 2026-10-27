import { keccak256 } from 'viem';
import { signScreeningCredential, assertCredentialCurrent } from './credential';
import { agentRegistration, assertValidatorConfiguration, readChainCertification, screeningChainConfig, screeningPayloadBytes, screeningLeaf, submitBridgeScreeningProof } from './chain';
import { privacyInfrastructure, validateHorizenReceipt } from '../proof.services/horizenReceipt';
import { decodeScreeningSignals, digest, fieldHash, screeningPolicy } from './policy';
import { ensureScreeningSchema, getScreeningCredential, getScreeningCredentialById, loadScreeningEvidence, screeningAudit, screeningQuery, type StoredScreeningCredential } from './repository';
import { openPrivateEvidence, sealPrivateEvidence } from './storage';
import { proveScreeningCredential } from './prover';

const busy = new Set<string>();
async function exclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  if (busy.has(key)) throw new Error('Screening operation already in progress');
  busy.add(key);
  try { return await task(); } finally { busy.delete(key); }
}
export function requireScreeningEnabled() {
  if (process.env.SCREENING_ENABLED !== 'true') throw new Error('Screening v2 rollout is disabled');
}
async function credential(commitment: string) {
  const result = await getScreeningCredential(commitment);
  if (!result || result.revoked) throw new Error('Credential unavailable or revoked');
  assertCredentialCurrent(JSON.parse(result.publicSignals), screeningChainConfig(), screeningChainConfig().issuerHash);
  return result;
}
function proofMatchesRelease(stored: StoredScreeningCredential, vkHash: string) {
  const release = process.env.SCREENING_RELEASE_MANIFEST_SHA256 || '';
  return /^[a-f0-9]{64}$/.test(release) && stored.provingReleaseSHA256 === release && stored.proofVKHash?.toLowerCase() === vkHash.toLowerCase();
}

export async function issueScreeningCredential(tutorId: string, actor: string) {
  requireScreeningEnabled();
  return exclusive(`issue:${tutorId}`, async () => {
    const config = screeningChainConfig();
    await assertValidatorConfiguration(config);
    await ensureScreeningSchema();
    const evidence = await loadScreeningEvidence(tutorId);
    const id = digest({ tutorId, evidence, policy: screeningPolicy, config });
    const existing = await getScreeningCredentialById(id);
    if (existing) {
      await credential(existing.commitment);
      return privateSummary(existing);
    }
    const key = process.env.SCREENING_ISSUER_KEY_HEX || '';
    if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('Dedicated screening issuer key required');
    const signed = await signScreeningCredential(evidence, config, Buffer.from(key, 'hex'));
    assertCredentialCurrent(signed.publicSignals, config, config.issuerHash);
    await assertValidatorConfiguration(config, signed.publicSignals);
    const encrypted = sealPrivateEvidence(Buffer.from(JSON.stringify({ evidence, input: signed.input })), id);
    const created = await screeningQuery(
      `MATCH (u:User {id: $tutorId})
       MERGE (c:TutorScreeningCredential {id: $id})
       ON CREATE SET c.tutorId = $tutorId, c.commitment = $commitment, c.publicSignals = $signals,
         c.encryptedEvidence = $encrypted, c.status = 'issued', c.shared = false, c.revoked = false,
         c.issuedAt = $issuedAt, c.expiresAt = $expiresAt
       MERGE (u)-[:HAS_SCREENING_CREDENTIAL]->(c) RETURN c`,
      { tutorId, id, commitment: signed.signals.credentialCommitment, signals: JSON.stringify(signed.publicSignals), encrypted,
        issuedAt: signed.signals.issuedAt, expiresAt: signed.signals.expiresAt });
    if (!created.records.length) throw new Error('Tutor no longer exists');
    await screeningAudit(actor, 'issue', created.records[0]!.get('c').properties.commitment);
    return privateSummary(created.records[0]!.get('c').properties);
  });
}

export async function generateScreeningProof(commitment: string, actor: string) {
  requireScreeningEnabled();
  return exclusive(`proof:${commitment}`, async () => {
    const stored = await credential(commitment);
    if (stored.proof && proofMatchesRelease(stored, screeningChainConfig().vkHash)) return privateSummary(stored);
    if (stored.zkVerifyTx || stored.status === 'submitting_zkverify') throw Error('Submitted screening proof requires reconciliation before changing its release');
    const { input } = JSON.parse(openPrivateEvidence(stored.encryptedEvidence, stored.id).toString());
    const result = await proveScreeningCredential(input, JSON.parse(stored.publicSignals));
    const saved = await screeningQuery(`MATCH (c:TutorScreeningCredential {commitment: $commitment})
      SET c.writeVersion = coalesce(c.writeVersion, 0) + 1 WITH c
      WHERE c.revoked = false AND c.publicSignals = $signals AND c.zkVerifyTx IS NULL AND c.status IN ['issued','proof_ready']
      SET c.proof = $proof, c.provingReleaseSHA256 = $release, c.proofVKHash = $vk, c.status = 'proof_ready' RETURN c`,
      { commitment, signals: stored.publicSignals, proof: JSON.stringify(result.proof), release: result.releaseManifestSHA256, vk: result.vkHash });
    if (!saved.records.length) throw Error('Screening credential changed while its proof was being generated');
    await screeningAudit(actor, 'generate_proof', commitment);
    return { commitment, status: 'proof_ready', certified: false };
  });
}

export async function submitScreeningProof(commitment: string, actor: string) {
  requireScreeningEnabled();
  return exclusive(`submit:${commitment}`, async () => {
    const stored = await credential(commitment), config = screeningChainConfig();
    if (!stored.shared) throw new Error('Tutor publication consent required before zkVerify submission');
    if (!stored.proof) throw new Error('Generate the approved proof first');
    if (stored.zkVerifyTx) return privateSummary(stored);
    if (!proofMatchesRelease(stored, config.vkHash)) throw Error('Screening proof must be regenerated for the current reviewed release');
    await assertValidatorConfiguration(config, JSON.parse(stored.publicSignals));
    // The durable claim is the publication authorization point. Concurrent unsharing
    // after it cannot retract an already authorized, irreversible chain submission.
    const claimed = await screeningQuery(`MATCH (c:TutorScreeningCredential {commitment: $commitment})
      SET c.writeVersion = coalesce(c.writeVersion, 0) + 1 WITH c
      WHERE c.revoked = false AND c.shared = true AND c.status = 'proof_ready'
        AND c.publicSignals = $signals AND c.proof = $proof
        AND c.provingReleaseSHA256 = $release AND c.proofVKHash = $vk
      SET c.status = 'submitting_zkverify', c.publicationAuthorizedAt = $now RETURN c`,
      { commitment, signals: stored.publicSignals, proof: stored.proof, release: stored.provingReleaseSHA256,
        vk: stored.proofVKHash, now: new Date().toISOString() });
    if (!claimed.records.length) throw new Error('Proof submission is already in progress or requires reconciliation');
    const { submission } = await submitBridgeScreeningProof(JSON.parse(stored.proof), JSON.parse(stored.publicSignals));
    const result = JSON.parse(submission.transactionResult);
    if (!/^0x[a-fA-F0-9]{64}$/.test(result.txHash || '')) throw new Error('Engine submission has no confirmed zkVerify transaction');
    if (result.statement?.toLowerCase() !== screeningLeaf(config.vkHash, JSON.parse(stored.publicSignals)).toLowerCase()) throw new Error('zkVerify statement differs from issued credential');
    await screeningQuery("MATCH (c:TutorScreeningCredential {commitment: $commitment}) SET c.zkVerifyTx = $tx, c.zkVerifyResult = $result, c.engineSubmissionId = $submissionId, c.status = 'awaiting_horizen_validation'", {
      commitment, submissionId: submission.id, tx: result.txHash, result: JSON.stringify({ status: result.status, txHash: result.txHash, blockHash: result.blockHash, statement: result.statement, aggregationId: result.aggregationId, domainId: result.domainId }) });
    await screeningAudit(actor, 'submit_zkverify', commitment);
    return { commitment, status: 'awaiting_horizen_validation', certified: false, zkVerifyTx: result.txHash };
  });
}

export async function requestScreeningValidation(commitment: string, actor: string) {
  requireScreeningEnabled();
  const stored = await credential(commitment), config = screeningChainConfig();
  if (!stored.shared || !stored.zkVerifyTx) throw new Error('Tutor sharing consent and zkVerify submission required');
  const values = JSON.parse(stored.publicSignals);
  await assertValidatorConfiguration(config, values);
  return { status: 'awaiting_horizen_validation', certified: false,
    instruction: 'Resolve the exact zkVerify aggregation receipt and certify it against the existing Horizen bridge. No ERC-8004 request is needed.' };
}

export interface AggregationReceipt { aggregationId: string; merklePath: string[]; leafCount: string; index: string }
export async function finalizeScreeningValidation(commitment: string, receipt: AggregationReceipt, actor: string) {
  requireScreeningEnabled();
  validateHorizenReceipt(receipt);
  const stored = await credential(commitment), config = screeningChainConfig();
  if (!stored.zkVerifyTx || !stored.shared) throw new Error('Submission and sharing consent required');
  const values = JSON.parse(stored.publicSignals);
  await assertValidatorConfiguration(config, values);
    const receiptJson = JSON.stringify(receipt);
    if (!await readChainCertification(config, values, receiptJson)) throw new Error('Screening receipt is not finalized on Horizen');
    const saved = await screeningQuery(`MATCH (c:TutorScreeningCredential {commitment: $commitment})
      SET c.writeVersion = coalesce(c.writeVersion, 0) + 1 WITH c
      WHERE c.revoked = false AND c.shared = true AND c.zkVerifyTx IS NOT NULL
        AND (c.receiptJson IS NULL OR c.receiptJson = $receiptJson)
      SET c.receiptJson = $receiptJson, c.status = 'verified' RETURN c`, { commitment, receiptJson });
    if (!saved.records.length) throw new Error('Credential was revoked, unshared or has a different receipt');
    await screeningAudit(actor, 'verify_bridge_receipt', commitment);
    return { commitment, status: 'verified', certified: true, infrastructure: 'bridge_only', revocationEnforcement: 'issuer' };
}

export async function revokeScreeningCredential(commitment: string, actor: string) {
  requireScreeningEnabled();
  const stored = await getScreeningCredential(commitment);
  if (!stored) throw new Error('Credential not found');
  // Revocation is issuer-managed; no governance transaction is submitted.
  await screeningQuery("MATCH (c:TutorScreeningCredential {commitment: $commitment}) SET c.writeVersion = coalesce(c.writeVersion, 0) + 1, c.revoked = true, c.status = 'revoked'", { commitment });
  await screeningAudit(actor, 'revoke', commitment);
  return { commitment, status: 'revoked', revocationEnforcement: 'issuer', onChainRevocationTransactionId: null };
}

export function privateSummary(stored: StoredScreeningCredential) {
  return { commitment: stored.commitment, status: stored.status, shared: stored.shared, revoked: stored.revoked,
    issuedAt: stored.issuedAt, expiresAt: stored.expiresAt, zkVerifyTx: stored.zkVerifyTx || null,
    verificationUrl: stored.shared ? `https://api.fluentxverse.com/screening/public/${stored.commitment}` : null };
}
export async function currentPrivateSummary(stored: StoredScreeningCredential) {
  const summary = privateSummary(stored);
  if (stored.revoked) summary.status = 'revoked';
  else if (BigInt(stored.expiresAt) <= BigInt(Math.floor(Date.now() / 1000))) summary.status = 'expired';
  else if (stored.zkVerifyTx && process.env.SCREENING_ENABLED !== 'true') summary.status = 'unavailable';
  else if (stored.zkVerifyTx && process.env.SCREENING_ENABLED === 'true') {
    try { summary.status = await readChainCertification(screeningChainConfig(), JSON.parse(stored.publicSignals), stored.receiptJson) ? 'verified' : 'pending'; }
    catch { summary.status = 'verification_unavailable'; }
  }
  return summary;
}
export async function shareScreeningCredential(tutorId: string, commitment: string, shared: boolean) {
  requireScreeningEnabled();
  const stored = await getScreeningCredential(commitment);
  if (!stored || stored.tutorId !== tutorId) throw new Error('Credential not found');
  await screeningQuery(`MATCH (c:TutorScreeningCredential {commitment: $commitment, tutorId: $tutorId})
    SET c.writeVersion = coalesce(c.writeVersion, 0) + 1, c.shared = $shared`, { commitment, tutorId, shared });
  await screeningAudit(tutorId, shared ? 'share' : 'unshare', commitment);
  return privateSummary({ ...stored, shared });
}
export async function publicScreeningSummary(commitment: string) {
  const stored = await getScreeningCredential(commitment);
  if (!stored?.shared) return null;
  const values = JSON.parse(stored.publicSignals), signals = decodeScreeningSignals(values);
  if (signals.subjectHash !== fieldHash({ tutorId: stored.tutorId })) throw new Error('Credential subject binding is invalid');
  let destination: ReturnType<typeof screeningChainConfig> | null = null;
  try { destination = screeningChainConfig(); } catch { /* Verification remains unavailable without approved trust roots. */ }
  let status = stored.revoked ? 'revoked' : BigInt(signals.expiresAt) <= BigInt(Math.floor(Date.now() / 1000)) ? 'expired' : 'pending';
  if (status === 'pending') {
    if (process.env.SCREENING_ENABLED !== 'true') status = 'unavailable';
    else {
      try { status = await readChainCertification(screeningChainConfig(), values, stored.receiptJson) ? 'verified' : 'pending'; }
      catch { status = 'unavailable'; }
    }
  }
  const bridgeOnly = privacyInfrastructure() === 'bridge_only';
  return { commitment, tutorId: stored.tutorId, subjectHash: signals.subjectHash, status, certified: status === 'verified', validationResponse: !bridgeOnly && status === 'verified' ? 100 : null,
    infrastructure: privacyInfrastructure(), revocationEnforcement: bridgeOnly ? 'issuer' : 'contract',
    receipt: bridgeOnly && stored.receiptJson ? JSON.parse(stored.receiptJson) : null,
    validationMeaning: 'Credential verification outcome, not the tutor exam score', policyId: screeningPolicy.id,
    claim: screeningPolicy.claim, limitations: screeningPolicy.limitations, issuedAt: signals.issuedAt, expiresAt: signals.expiresAt,
    assurance: { releasePolicy: process.env.SCREENING_RELEASE_POLICY || 'independent-reviewed',
      independentlyReviewed: process.env.SCREENING_RELEASE_POLICY !== 'self-operated',
      setupTrust: process.env.SCREENING_RELEASE_POLICY === 'self-operated' ? 'FluentXVerse-operated trusted setup; entropy destruction is operator-asserted' : 'Independently reviewed multi-party setup' },
    publicSignals: values, proof: stored.proof ? JSON.parse(stored.proof) : null,
    agent: agentRegistration(destination || undefined),
    verification: destination ? { chainId: destination.chainId, agentId: bridgeOnly ? null : destination.agentId, adapterAddress: bridgeOnly ? null : destination.adapterAddress,
      identityRegistry: bridgeOnly ? null : destination.identityRegistry, validationRegistry: bridgeOnly ? null : destination.validationRegistry, receiptBridge: destination.bridge,
      vkHash: destination.vkHash, issuerHash: destination.issuerHash, domainId: destination.domainId,
      requestHash: keccak256(screeningPayloadBytes(destination, values)), statement: screeningLeaf(destination.vkHash, values) } : null,
    zkVerifyTx: stored.zkVerifyTx || null };
}

export async function registerScreeningAgent(_actor: string) {
  throw new Error('ERC-8004 registration is disabled; custom screening contracts are archived');
}
