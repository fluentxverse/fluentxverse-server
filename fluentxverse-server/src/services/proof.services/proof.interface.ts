export type TutorCertificationProofStatus =
  | 'requirements_incomplete'
  | 'ready_for_proving'
  | 'local_proof_generated'
  | 'submitted'
  | 'verified'
  | 'failed';

export type TutorCertificationRequirement =
  | 'written_exam'
  | 'speaking_exam'
  | 'profile_approval'
  | 'interview_pass';

export interface TutorCertificationSnapshot {
  tutorId: string;
  email?: string;
  walletAddress?: string;
  smartWalletAddress?: string;
  writtenPassed: boolean;
  writtenScore: number | null;
  writtenPassedAt: string | null;
  writtenExamId: string | null;
  speakingPassed: boolean;
  speakingScore: number | null;
  speakingPassedAt: string | null;
  speakingExamId: string | null;
  profileApproved: boolean;
  profileStatus: string;
  interviewPassed: boolean;
  interviewCompletedAt: string | null;
  interviewSlotId: string | null;
  interviewResult: string | null;
  interviewRubricScores: Record<string, number> | null;
  missingRequirements: TutorCertificationRequirement[];
}

export interface AssessmentRecordInput {
  tutorId: string;
  assessmentType: 'written' | 'speaking' | 'interview';
  sourceRefId: string;
  score: number | null;
  passed: boolean;
  passingThreshold: number | null;
  modelName?: string | null;
  rubricHash?: string | null;
  artifactHashes: Record<string, string | null>;
  assessedAt: string;
  metadata?: Record<string, unknown>;
}

export interface TutorCertificationCredential {
  id: string;
  tutorId: string;
  status: TutorCertificationProofStatus;
  credentialCommitment: string | null;
  schemaVersion: string;
  circuitVersion: string;
  proofSystem: string;
  issuer: string;
  publicSignals: Record<string, unknown> | null;
  missingRequirements: TutorCertificationRequirement[];
  zkVerifyTxHash?: string | null;
  zkVerifyAggregationId?: string | null;
  issuedAt?: string | null;
  verifiedAt?: string | null;
  expiresAt?: string | null;
  updatedAt: string;
}
