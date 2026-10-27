import neo4j from 'neo4j-driver';
import { getDriver } from '../../db/memgraph';
import type { TutorCertificationCredential, TutorCertificationRequirement, TutorCertificationSnapshot } from './proof.interface';
import { LEGACY_PROOF_RETIREMENT_REASON, retiredCredentialStatus } from './legacyProofRetirement';

const SCHEMA_VERSION = 'fluentxverse.tutor-certification.v1';
const CIRCUIT_VERSION = 'tutor-certification-circom.v1';
const PROOF_SYSTEM = 'groth16';
type SessionLike = ReturnType<ReturnType<typeof getDriver>['session']>;
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (neo4j.isInt(value)) return value.toNumber();
  if (typeof value === 'object' && value !== null && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    return (value as { toNumber: () => number }).toNumber();
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value !== null && typeof (value as { toString?: unknown }).toString === 'function') {
    return String(value);
  }
  return null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value !== 'string') return value as T;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function missingRequirements(snapshot: Omit<TutorCertificationSnapshot, 'missingRequirements'>): TutorCertificationRequirement[] {
  const missing: TutorCertificationRequirement[] = [];
  if (!snapshot.writtenPassed) missing.push('written_exam');
  if (!snapshot.speakingPassed) missing.push('speaking_exam');
  if (!snapshot.profileApproved) missing.push('profile_approval');
  if (!snapshot.interviewPassed) missing.push('interview_pass');
  return missing;
}

async function getLatestCompletedExam(session: SessionLike, tutorId: string, type: 'written' | 'speaking') {
  const result = await session.run(
    `MATCH (:User {id: $tutorId})-[:TAKES]->(e:Exam {type: $type, status: 'completed'})
     RETURN e
     ORDER BY e.completedAt DESC
     LIMIT 1`,
    { tutorId, type }
  );

  return result.records[0]?.get('e')?.properties ?? null;
}

async function getLatestInterviewResult(session: SessionLike, tutorId: string) {
  const result = await session.run(
    `MATCH (s:InterviewSlot {tutorId: $tutorId, status: 'completed'})
     RETURN s
     ORDER BY s.completedAt DESC
     LIMIT 1`,
    { tutorId }
  );

  return result.records[0]?.get('s')?.properties ?? null;
}

async function loadCertificationSnapshot(session: SessionLike, tutorId: string): Promise<TutorCertificationSnapshot> {
  const userResult = await session.run(
    `MATCH (u:User {id: $tutorId})
     RETURN u`,
    { tutorId }
  );

  const user = userResult.records[0]?.get('u')?.properties;
  if (!user) {
    throw new Error('Tutor not found');
  }

  const writtenExam = await getLatestCompletedExam(session, tutorId, 'written');
  const speakingExam = await getLatestCompletedExam(session, tutorId, 'speaking');
  const interviewSlot = await getLatestInterviewResult(session, tutorId);

  const writtenResult = parseJson<Record<string, unknown>>(writtenExam?.result, {});
  const speakingResult = parseJson<Record<string, unknown>>(speakingExam?.result, {});
  const interviewRubricScores = parseJson<Record<string, number> | null>(interviewSlot?.rubricScores, null);

  const snapshotBase = {
    tutorId,
    email: user.email,
    walletAddress: user.walletAddress,
    smartWalletAddress: user.smartWalletAddress,
    writtenPassed: toBoolean(user.writtenExamPassed) || writtenResult.passed === true,
    writtenScore: toNumber(user.writtenExamScore) ?? toNumber(writtenResult.percentage),
    writtenPassedAt: toIsoString(user.writtenExamPassedAt) || toIsoString(writtenResult.completedAt),
    writtenExamId: writtenExam?.id ?? null,
    speakingPassed: toBoolean(user.speakingExamPassed) || speakingResult.passed === true,
    speakingScore: toNumber(user.speakingExamScore) ?? toNumber(speakingResult.overallScore),
    speakingPassedAt: toIsoString(user.speakingExamPassedAt) || toIsoString(speakingResult.completedAt),
    speakingExamId: speakingExam?.id ?? null,
    profileApproved: user.profileStatus === 'approved',
    profileStatus: user.profileStatus || 'incomplete',
    interviewPassed: toBoolean(user.interviewPassed) || interviewSlot?.result === 'pass',
    interviewCompletedAt: toIsoString(user.interviewPassedAt) || toIsoString(interviewSlot?.completedAt),
    interviewSlotId: interviewSlot?.id ?? null,
    interviewResult: interviewSlot?.result ?? null,
    interviewRubricScores,
  };

  return {
    ...snapshotBase,
    missingRequirements: missingRequirements(snapshotBase),
  };
}

function hydrateCredential(props: Record<string, unknown>): TutorCertificationCredential {
  return {
    id: String(props.id || ''),
    tutorId: String(props.tutorId || ''),
    status: retiredCredentialStatus(props),
    verificationAvailable: false,
    retirementReason: LEGACY_PROOF_RETIREMENT_REASON,
    credentialCommitment: (props.credentialCommitment as string | null) || null,
    schemaVersion: String(props.schemaVersion || SCHEMA_VERSION),
    circuitVersion: String(props.circuitVersion || CIRCUIT_VERSION),
    proofSystem: String(props.proofSystem || PROOF_SYSTEM),
    issuer: String(props.issuer || 'fluentxverse:tutor-certification:v1'),
    publicSignals: parseJson<Record<string, unknown> | null>(props.publicSignals, null),
    missingRequirements: parseJson<TutorCertificationRequirement[]>(props.missingRequirements, []),
    zkVerifyTxHash: (props.zkVerifyTxHash as string | null) || null,
    zkVerifyAggregationId: (props.zkVerifyAggregationId as string | null) || null,
    issuedAt: toIsoString(props.issuedAt),
    verifiedAt: null,
    expiresAt: toIsoString(props.expiresAt),
    updatedAt: toIsoString(props.updatedAt) || new Date().toISOString(),
  };
}


export async function getTutorCertificationProofStatus(tutorId: string): Promise<{
  snapshot: TutorCertificationSnapshot; credential: TutorCertificationCredential;
}> {
  const session = getDriver().session();
  try {
    const snapshot = await loadCertificationSnapshot(session, tutorId);
    const result = await session.run(
      'MATCH (:User {id: $tutorId})-[:HAS_CERTIFICATION_CREDENTIAL]->(c:TutorCertificationCredential) RETURN c LIMIT 1', { tutorId });
    const props = result.records[0]?.get('c')?.properties;
    return { snapshot, credential: hydrateCredential(props || { tutorId,
      id: `retired:tutor-certification:${tutorId}`, missingRequirements: snapshot.missingRequirements }) };
  } finally { await session.close(); }
}

// Compatibility endpoint: never issues, renews or rewrites legacy evidence.
export async function maybeIssueTutorCertificationProof(tutorId: string, _trigger = 'manual') {
  return getTutorCertificationProofStatus(tutorId);
}
export async function getPublicTutorCertificationCredential(credentialCommitment: string): Promise<{
  tutor: {
    id: string;
    displayName: string;
    profilePicture?: string | null;
  };
  credential: TutorCertificationCredential & {
    localProofVerified?: boolean;
    localProofGeneratedAt?: string | null;
    localProofHash?: string | null;
    localPublicSignalsHash?: string | null;
    localVerificationKeyHash?: string | null;
    zkVerifySubmittedAt?: string | null;
    zkVerifyVerifiedAt?: string | null;
    zkVerifyBlockHash?: string | null;
    zkVerifyTransactionStatus?: string | null;
    zkVerifyDomainId?: string | null;
    zkVerifyStatement?: string | null;
  };
} | null> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const result = await session.run(
      `MATCH (c:TutorCertificationCredential {credentialCommitment: $credentialCommitment})<-[:HAS_CERTIFICATION_CREDENTIAL]-(u:User)
       RETURN u, c
       LIMIT 1`,
      { credentialCommitment }
    );

    const record = result.records[0];
    if (!record) return null;

    const user = record.get('u').properties;
    const credentialProps = record.get('c').properties;
    const credential = hydrateCredential(credentialProps);

    return {
      tutor: {
        id: String(user.id),
        displayName: String(user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim()),
        profilePicture: (user.profilePicture as string | null) || null,
      },
      credential: {
        ...credential,
        localProofVerified: false,
        localProofGeneratedAt: toIsoString(credentialProps.localProofGeneratedAt),
        localProofHash: (credentialProps.localProofHash as string | null) || null,
        localPublicSignalsHash: (credentialProps.localPublicSignalsHash as string | null) || null,
        localVerificationKeyHash: (credentialProps.localVerificationKeyHash as string | null) || null,
        zkVerifySubmittedAt: toIsoString(credentialProps.zkVerifySubmittedAt),
        zkVerifyVerifiedAt: toIsoString(credentialProps.zkVerifyVerifiedAt),
        zkVerifyBlockHash: (credentialProps.zkVerifyBlockHash as string | null) || null,
        zkVerifyTransactionStatus: (credentialProps.zkVerifyTransactionStatus as string | null) || null,
        zkVerifyDomainId: credentialProps.zkVerifyDomainId != null ? String(credentialProps.zkVerifyDomainId) : null,
        zkVerifyStatement: (credentialProps.zkVerifyStatement as string | null) || null,
      },
    };
  } finally {
    await session.close();
  }
}
