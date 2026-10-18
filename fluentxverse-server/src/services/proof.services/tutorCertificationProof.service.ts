import { createHash, createHmac } from 'node:crypto';
import { buildEddsa, buildPoseidon } from 'circomlibjs';
import neo4j from 'neo4j-driver';
import { getDriver } from '../../db/memgraph';
import type {
  AssessmentRecordInput,
  TutorCertificationCredential,
  TutorCertificationProofStatus,
  TutorCertificationRequirement,
  TutorCertificationSnapshot,
} from './proof.interface';

const SCHEMA_VERSION = 'fluentxverse.tutor-certification.v1';
const CIRCUIT_VERSION = 'tutor-certification-circom.v1';
const PROOF_SYSTEM = 'groth16';
const WRITTEN_PASSING_SCORE = 90;
const SPEAKING_PASSING_SCORE = 85;
const CREDENTIAL_VALIDITY_DAYS = 365;
const BN254_FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

type SessionLike = ReturnType<ReturnType<typeof getDriver>['session']>;

interface AssessmentRecord {
  id: string;
  type: AssessmentRecordInput['assessmentType'];
  sourceRefId: string;
  payloadHash: string;
  issuerSignature: string;
}

export interface TutorCertificationCircuitInput {
  writtenScore: string;
  speakingScore: string;
  profileApproved: string;
  interviewPassed: string;
  subjectHash: string;
  credentialNonce: string;
  signatureR8x: string;
  signatureR8y: string;
  signatureS: string;
  credentialCommitment: string;
  credentialTypeHash: string;
  schemaVersionHash: string;
  issuerHash: string;
  issuerAx: string;
  issuerAy: string;
  assessmentRoot: string;
}

interface IssuerSignatureBundle {
  issuerAx: string;
  issuerAy: string;
  issuerHash: string;
  signatureR8x: string;
  signatureR8y: string;
  signatureS: string;
}

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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashJson(value: unknown): string {
  return `sha256:${sha256Hex(stableStringify(value))}`;
}

export function fieldElementFromHash(value: unknown): string {
  const hash = hashJson(value).replace(/^sha256:/, '');
  return (BigInt(`0x${hash}`) % BN254_FIELD_MODULUS).toString();
}

async function poseidonField(inputs: ReadonlyArray<string | number | bigint>): Promise<string> {
  const poseidon = await buildPoseidon();
  const output = poseidon(inputs.map((input) => BigInt(input)));
  return poseidon.F.toObject(output).toString();
}

async function getIssuerKeypair() {
  const eddsa = await buildEddsa();
  const secret = getIssuerSecret();
  const privateKey = createHash('sha256').update(secret).digest();
  const publicKey = eddsa.prv2pub(privateKey);
  const poseidon = await buildPoseidon();

  return {
    eddsa,
    poseidon,
    privateKey,
    publicKey: [
      poseidon.F.toObject(publicKey[0]).toString(),
      poseidon.F.toObject(publicKey[1]).toString(),
    ] as const,
  };
}

function getIssuer(): string {
  return process.env.TUTOR_CERT_ISSUER_ID || 'fluentxverse:tutor-certification:v1';
}

function getIssuerSecret(): string {
  const secret = process.env.TUTOR_CERT_ISSUER_SECRET || process.env.JWT_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('TUTOR_CERT_ISSUER_SECRET is required for tutor certification proofs');
  }

  return secret || 'dev-only-tutor-certification-issuer-secret';
}

function signPayload(payload: Record<string, unknown>): string {
  return `hmac-sha256:${createHmac('sha256', getIssuerSecret()).update(stableStringify(payload)).digest('hex')}`;
}

function credentialId(tutorId: string): string {
  return `tutor-certification:${SCHEMA_VERSION}:${tutorId}`;
}

function assessmentId(type: AssessmentRecordInput['assessmentType'], sourceRefId: string): string {
  return `ai-assessment:${SCHEMA_VERSION}:${type}:${sourceRefId}`;
}

function credentialCommitment(snapshot: TutorCertificationSnapshot): string {
  const salt = process.env.TUTOR_CERT_COMMITMENT_SALT || process.env.TUTOR_CERT_ISSUER_SECRET;
  if (!salt && process.env.NODE_ENV === 'production') {
    throw new Error('TUTOR_CERT_COMMITMENT_SALT is required for tutor certification proofs');
  }

  const subject = {
    tutorId: snapshot.tutorId,
    walletAddress: snapshot.smartWalletAddress || snapshot.walletAddress || null,
    salt: salt || 'dev-only-tutor-certification-commitment-salt',
  };

  return hashJson(subject);
}

function subjectHashField(snapshot: TutorCertificationSnapshot): string {
  return fieldElementFromHash({
    tutorId: snapshot.tutorId,
    walletAddress: snapshot.smartWalletAddress || snapshot.walletAddress || null,
  });
}

function credentialNonceField(snapshot: TutorCertificationSnapshot): string {
  return fieldElementFromHash({
    tutorId: snapshot.tutorId,
    schemaVersion: SCHEMA_VERSION,
    salt: process.env.TUTOR_CERT_COMMITMENT_SALT || process.env.TUTOR_CERT_ISSUER_SECRET || 'dev-only-tutor-certification-commitment-salt',
  });
}

async function credentialCommitmentField(snapshot: TutorCertificationSnapshot): Promise<string> {
  return poseidonField([subjectHashField(snapshot), credentialNonceField(snapshot)]);
}

async function credentialMessageField(input: {
  writtenScore: string;
  speakingScore: string;
  profileApproved: string;
  interviewPassed: string;
  credentialCommitment: string;
  credentialTypeHash: string;
  schemaVersionHash: string;
  issuerHash: string;
  assessmentRoot: string;
}): Promise<string> {
  return poseidonField([
    input.writtenScore,
    input.speakingScore,
    input.profileApproved,
    input.interviewPassed,
    input.credentialCommitment,
    input.credentialTypeHash,
    input.schemaVersionHash,
    input.issuerHash,
    input.assessmentRoot,
  ]);
}

async function signCredentialMessage(message: string): Promise<IssuerSignatureBundle> {
  const { eddsa, poseidon, privateKey, publicKey } = await getIssuerKeypair();
  const signature = eddsa.signPoseidon(privateKey, poseidon.F.e(BigInt(message)));
  const issuerHash = await poseidonField(publicKey);

  return {
    issuerAx: publicKey[0],
    issuerAy: publicKey[1],
    issuerHash,
    signatureR8x: poseidon.F.toObject(signature.R8[0]).toString(),
    signatureR8y: poseidon.F.toObject(signature.R8[1]).toString(),
    signatureS: BigInt(signature.S).toString(),
  };
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
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

async function ensureAssessmentRecord(session: SessionLike, input: AssessmentRecordInput): Promise<AssessmentRecord> {
  const id = assessmentId(input.assessmentType, input.sourceRefId);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    issuer: getIssuer(),
    tutorId: input.tutorId,
    assessmentType: input.assessmentType,
    sourceRefId: input.sourceRefId,
    score: input.score,
    passed: input.passed,
    passingThreshold: input.passingThreshold,
    modelName: input.modelName || null,
    rubricHash: input.rubricHash || null,
    artifactHashes: input.artifactHashes,
    assessedAt: input.assessedAt,
    metadata: input.metadata || {},
  };
  const payloadHash = hashJson(payload);
  const issuerSignature = signPayload(payload);
  const now = new Date().toISOString();

  await session.run(
    `MATCH (u:User {id: $tutorId})
     MERGE (a:AiAssessmentRecord {id: $id})
     SET a.schemaVersion = $schemaVersion,
         a.issuer = $issuer,
         a.tutorId = $tutorId,
         a.assessmentType = $assessmentType,
         a.sourceRefId = $sourceRefId,
         a.score = $score,
         a.passed = $passed,
         a.passingThreshold = $passingThreshold,
         a.modelName = $modelName,
         a.rubricHash = $rubricHash,
         a.artifactHashes = $artifactHashes,
         a.metadata = $metadata,
         a.payloadHash = $payloadHash,
         a.issuerSignature = $issuerSignature,
         a.assessedAt = $assessedAt,
         a.updatedAt = $now,
         a.createdAt = coalesce(a.createdAt, $now)
     MERGE (u)-[:HAS_ASSESSMENT]->(a)`,
    {
      id,
      schemaVersion: SCHEMA_VERSION,
      issuer: getIssuer(),
      tutorId: input.tutorId,
      assessmentType: input.assessmentType,
      sourceRefId: input.sourceRefId,
      score: input.score,
      passed: input.passed,
      passingThreshold: input.passingThreshold,
      modelName: input.modelName || null,
      rubricHash: input.rubricHash || null,
      artifactHashes: JSON.stringify(input.artifactHashes),
      metadata: JSON.stringify(input.metadata || {}),
      payloadHash,
      issuerSignature,
      assessedAt: input.assessedAt,
      now,
    }
  );

  return {
    id,
    type: input.assessmentType,
    sourceRefId: input.sourceRefId,
    payloadHash,
    issuerSignature,
  };
}

async function ensureWrittenAssessment(session: SessionLike, snapshot: TutorCertificationSnapshot): Promise<AssessmentRecord | null> {
  if (!snapshot.writtenPassed || !snapshot.writtenExamId) return null;

  const exam = await getLatestCompletedExam(session, snapshot.tutorId, 'written');
  if (!exam) return null;

  const result = parseJson<Record<string, unknown>>(exam.result, {});
  const content = parseJson<Record<string, unknown>>(exam.content, {});

  return ensureAssessmentRecord(session, {
    tutorId: snapshot.tutorId,
    assessmentType: 'written',
    sourceRefId: snapshot.writtenExamId,
    score: snapshot.writtenScore,
    passed: true,
    passingThreshold: WRITTEN_PASSING_SCORE,
    modelName: 'fluentxverse-ai-generated-written-exam-deterministic-grader',
    rubricHash: hashJson({
      passingScore: WRITTEN_PASSING_SCORE,
      sections: ['grammar', 'vocabulary', 'comprehension'],
    }),
    artifactHashes: {
      examContentHash: hashJson(content),
      answerHash: hashJson(result.answers || []),
      resultHash: hashJson(result),
    },
    assessedAt: snapshot.writtenPassedAt || new Date().toISOString(),
    metadata: {
      sectionScores: result.sectionScores || null,
    },
  });
}

async function ensureSpeakingAssessment(session: SessionLike, snapshot: TutorCertificationSnapshot): Promise<AssessmentRecord | null> {
  if (!snapshot.speakingPassed || !snapshot.speakingExamId) return null;

  const exam = await getLatestCompletedExam(session, snapshot.tutorId, 'speaking');
  if (!exam) return null;

  const result = parseJson<Record<string, unknown>>(exam.result, {});
  const content = parseJson<Record<string, unknown>>(exam.content, {});
  const taskScores = Array.isArray(result.taskScores) ? result.taskScores : [];
  const transcripts = taskScores.map((task: any) => ({
    taskId: task.taskId,
    transcription: task.transcription,
  }));

  return ensureAssessmentRecord(session, {
    tutorId: snapshot.tutorId,
    assessmentType: 'speaking',
    sourceRefId: snapshot.speakingExamId,
    score: snapshot.speakingScore,
    passed: true,
    passingThreshold: SPEAKING_PASSING_SCORE,
    modelName: 'fluentxverse-ai-speaking-assessment',
    rubricHash: hashJson({
      passingScore: SPEAKING_PASSING_SCORE,
      sections: ['pronunciation', 'fluency', 'vocabulary', 'grammar', 'coherence', 'taskCompletion'],
    }),
    artifactHashes: {
      examContentHash: hashJson(content),
      transcriptHash: hashJson(transcripts),
      taskScoreHash: hashJson(taskScores),
      resultHash: hashJson(result),
    },
    assessedAt: snapshot.speakingPassedAt || new Date().toISOString(),
    metadata: {
      sectionAverages: result.sectionAverages || null,
    },
  });
}

async function ensureInterviewAssessment(session: SessionLike, snapshot: TutorCertificationSnapshot): Promise<AssessmentRecord | null> {
  if (!snapshot.interviewPassed || !snapshot.interviewSlotId) return null;

  const interview = await getLatestInterviewResult(session, snapshot.tutorId);
  if (!interview) return null;

  const rubricScores = parseJson<Record<string, number> | null>(interview.rubricScores, null);
  const timestamps = parseJson<unknown[]>(interview.timestamps, []);

  return ensureAssessmentRecord(session, {
    tutorId: snapshot.tutorId,
    assessmentType: 'interview',
    sourceRefId: snapshot.interviewSlotId,
    score: null,
    passed: true,
    passingThreshold: null,
    modelName: 'fluentxverse-human-interview-rubric',
    rubricHash: hashJson(rubricScores || {}),
    artifactHashes: {
      rubricScoresHash: hashJson(rubricScores || {}),
      notesHash: hashJson(interview.notes || ''),
      timestampsHash: hashJson(timestamps),
      recordingHash: hashJson(interview.recordingUrl || null),
    },
    assessedAt: snapshot.interviewCompletedAt || new Date().toISOString(),
    metadata: {
      date: interview.date || null,
      time: interview.time || null,
      reviewedBy: interview.reviewedBy || null,
    },
  });
}

async function buildPublicSignals(snapshot: TutorCertificationSnapshot, assessments: AssessmentRecord[]) {
  const sortedAssessments = [...assessments].sort((a, b) => a.id.localeCompare(b.id));
  const issuer = await getIssuerKeypair();
  const issuerHash = await poseidonField(issuer.publicKey);
  const assessmentRootFields = sortedAssessments.map((assessment) => ({
    id: assessment.id,
    type: assessment.type,
    payloadHash: assessment.payloadHash,
    issuerSignature: assessment.issuerSignature,
  }));

  return {
    credentialTypeHash: hashJson('fluentxverse.tutor.ai-verified-certification'),
    credentialCommitment: credentialCommitment(snapshot),
    credentialCommitmentField: await credentialCommitmentField(snapshot),
    credentialTypeHashField: fieldElementFromHash('fluentxverse.tutor.ai-verified-certification'),
    schemaVersionHashField: fieldElementFromHash(SCHEMA_VERSION),
    issuerHashField: issuerHash,
    issuerAx: issuer.publicKey[0],
    issuerAy: issuer.publicKey[1],
    schemaVersion: SCHEMA_VERSION,
    circuitVersion: CIRCUIT_VERSION,
    issuer: getIssuer(),
    writtenThreshold: WRITTEN_PASSING_SCORE,
    speakingThreshold: SPEAKING_PASSING_SCORE,
    requirementSetHash: hashJson(['written_exam', 'speaking_exam', 'profile_approval', 'interview_pass']),
    assessmentRoot: hashJson(assessmentRootFields),
    assessmentRootField: fieldElementFromHash(assessmentRootFields),
  };
}

export async function buildTutorCertificationCircuitInput(
  snapshot: TutorCertificationSnapshot,
  credential?: TutorCertificationCredential
): Promise<TutorCertificationCircuitInput> {
  const writtenScore = snapshot.writtenScore ?? 0;
  const speakingScore = snapshot.speakingScore ?? 0;
  const publicSignals = credential?.publicSignals || {};
  const issuer = await getIssuerKeypair();
  const credentialBase = {
    writtenScore: String(Math.trunc(writtenScore)),
    speakingScore: String(Math.trunc(speakingScore)),
    profileApproved: snapshot.profileApproved ? '1' : '0',
    interviewPassed: snapshot.interviewPassed ? '1' : '0',
    credentialCommitment: String(publicSignals.credentialCommitmentField || await credentialCommitmentField(snapshot)),
    credentialTypeHash: String(publicSignals.credentialTypeHashField || fieldElementFromHash('fluentxverse.tutor.ai-verified-certification')),
    schemaVersionHash: String(publicSignals.schemaVersionHashField || fieldElementFromHash(SCHEMA_VERSION)),
    issuerHash: String(publicSignals.issuerHashField || await poseidonField(issuer.publicKey)),
    issuerAx: String(publicSignals.issuerAx || issuer.publicKey[0]),
    issuerAy: String(publicSignals.issuerAy || issuer.publicKey[1]),
    assessmentRoot: String(publicSignals.assessmentRootField || fieldElementFromHash({
      tutorId: snapshot.tutorId,
      writtenExamId: snapshot.writtenExamId,
      speakingExamId: snapshot.speakingExamId,
      interviewSlotId: snapshot.interviewSlotId,
      schemaVersion: SCHEMA_VERSION,
    })),
  };
  const message = await credentialMessageField(credentialBase);
  const signature = await signCredentialMessage(message);

  return {
    writtenScore: credentialBase.writtenScore,
    speakingScore: credentialBase.speakingScore,
    profileApproved: credentialBase.profileApproved,
    interviewPassed: credentialBase.interviewPassed,
    subjectHash: subjectHashField(snapshot),
    credentialNonce: credentialNonceField(snapshot),
    signatureR8x: signature.signatureR8x,
    signatureR8y: signature.signatureR8y,
    signatureS: signature.signatureS,
    credentialCommitment: credentialBase.credentialCommitment,
    credentialTypeHash: credentialBase.credentialTypeHash,
    schemaVersionHash: credentialBase.schemaVersionHash,
    issuerHash: credentialBase.issuerHash,
    issuerAx: credentialBase.issuerAx,
    issuerAy: credentialBase.issuerAy,
    assessmentRoot: credentialBase.assessmentRoot,
  };
}

function hydrateCredential(props: Record<string, unknown>): TutorCertificationCredential {
  return {
    id: String(props.id || ''),
    tutorId: String(props.tutorId || ''),
    status: (props.status as TutorCertificationProofStatus) || 'requirements_incomplete',
    credentialCommitment: (props.credentialCommitment as string | null) || null,
    schemaVersion: String(props.schemaVersion || SCHEMA_VERSION),
    circuitVersion: String(props.circuitVersion || CIRCUIT_VERSION),
    proofSystem: String(props.proofSystem || PROOF_SYSTEM),
    issuer: String(props.issuer || getIssuer()),
    publicSignals: parseJson<Record<string, unknown> | null>(props.publicSignals, null),
    missingRequirements: parseJson<TutorCertificationRequirement[]>(props.missingRequirements, []),
    zkVerifyTxHash: (props.zkVerifyTxHash as string | null) || null,
    zkVerifyAggregationId: (props.zkVerifyAggregationId as string | null) || null,
    issuedAt: toIsoString(props.issuedAt),
    verifiedAt: toIsoString(props.verifiedAt),
    expiresAt: toIsoString(props.expiresAt),
    updatedAt: toIsoString(props.updatedAt) || new Date().toISOString(),
  };
}

async function upsertCredential(
  session: SessionLike,
  snapshot: TutorCertificationSnapshot,
  assessments: AssessmentRecord[],
  trigger: string
): Promise<TutorCertificationCredential> {
  const now = new Date();
  const complete = snapshot.missingRequirements.length === 0;
  const status: TutorCertificationProofStatus = complete ? 'ready_for_proving' : 'requirements_incomplete';
  const publicSignals = complete ? await buildPublicSignals(snapshot, assessments) : null;
  const id = credentialId(snapshot.tutorId);
  const issuedAt = complete ? now.toISOString() : null;
  const expiresAt = complete ? addDays(now, CREDENTIAL_VALIDITY_DAYS).toISOString() : null;
  const commitment = complete ? credentialCommitment(snapshot) : null;

  const result = await session.run(
    `MATCH (u:User {id: $tutorId})
     MERGE (c:TutorCertificationCredential {id: $id})
     SET c.tutorId = $tutorId,
         c.status = CASE
           WHEN $status = 'ready_for_proving' AND c.status IN ['local_proof_generated', 'submitted', 'verified'] THEN c.status
           ELSE $status
         END,
         c.schemaVersion = $schemaVersion,
         c.circuitVersion = $circuitVersion,
         c.proofSystem = $proofSystem,
         c.issuer = $issuer,
         c.credentialCommitment = $credentialCommitment,
         c.publicSignals = $publicSignals,
         c.missingRequirements = $missingRequirements,
         c.trigger = $trigger,
         c.issuedAt = coalesce(c.issuedAt, $issuedAt),
         c.expiresAt = coalesce(c.expiresAt, $expiresAt),
         c.updatedAt = $updatedAt,
         c.createdAt = coalesce(c.createdAt, $updatedAt)
     SET u.certificationStatus = CASE WHEN $status = 'ready_for_proving' THEN 'certified' ELSE coalesce(u.certificationStatus, 'pending') END,
         u.certificationStatusUpdatedAt = $updatedAt,
         u.tutorCertificationCredentialId = $id,
         u.tutorCertificationProofStatus = c.status
     MERGE (u)-[:HAS_CERTIFICATION_CREDENTIAL]->(c)
     RETURN c`,
    {
      id,
      tutorId: snapshot.tutorId,
      status,
      schemaVersion: SCHEMA_VERSION,
      circuitVersion: CIRCUIT_VERSION,
      proofSystem: PROOF_SYSTEM,
      issuer: getIssuer(),
      credentialCommitment: commitment,
      publicSignals: publicSignals ? JSON.stringify(publicSignals) : null,
      missingRequirements: JSON.stringify(snapshot.missingRequirements),
      trigger,
      issuedAt,
      expiresAt,
      updatedAt: now.toISOString(),
    }
  );

  const props = result.records[0]?.get('c')?.properties;
  if (!props) {
    throw new Error('Failed to upsert tutor certification credential');
  }

  for (const assessment of assessments) {
    await session.run(
      `MATCH (c:TutorCertificationCredential {id: $credentialId})
       MATCH (a:AiAssessmentRecord {id: $assessmentId})
       MERGE (c)-[:USES_ASSESSMENT]->(a)`,
      {
        credentialId: id,
        assessmentId: assessment.id,
      }
    );
  }

  return hydrateCredential(props);
}

export async function maybeIssueTutorCertificationProof(
  tutorId: string,
  trigger = 'manual'
): Promise<{ snapshot: TutorCertificationSnapshot; credential: TutorCertificationCredential }> {
  const driver = getDriver();
  const session = driver.session();

  try {
    const snapshot = await loadCertificationSnapshot(session, tutorId);
    const assessments: AssessmentRecord[] = [];

    if (snapshot.writtenPassed) {
      const assessment = await ensureWrittenAssessment(session, snapshot);
      if (assessment) assessments.push(assessment);
    }

    if (snapshot.speakingPassed) {
      const assessment = await ensureSpeakingAssessment(session, snapshot);
      if (assessment) assessments.push(assessment);
    }

    if (snapshot.interviewPassed) {
      const assessment = await ensureInterviewAssessment(session, snapshot);
      if (assessment) assessments.push(assessment);
    }

    const credential = await upsertCredential(session, snapshot, assessments, trigger);
    return { snapshot, credential };
  } finally {
    await session.close();
  }
}

export async function tryIssueTutorCertificationProof(tutorId: string, trigger: string): Promise<void> {
  try {
    await maybeIssueTutorCertificationProof(tutorId, trigger);
  } catch (error) {
    console.warn('Failed to update tutor certification proof state:', {
      tutorId,
      trigger,
      error: error instanceof Error ? error.message : error,
    });
  }
}

export async function getTutorCertificationProofStatus(
  tutorId: string
): Promise<{ snapshot: TutorCertificationSnapshot; credential: TutorCertificationCredential }> {
  return maybeIssueTutorCertificationProof(tutorId, 'status_check');
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
        localProofVerified: Boolean(credentialProps.localProofVerified),
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
