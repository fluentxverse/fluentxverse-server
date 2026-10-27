import { LegacyProofRetiredError } from './legacyProofRetirement';

export interface ZkVerifySubmissionResult {
  credentialId: string; txHash: string | null; blockHash: string | null; status: string;
  proofType: string; domainId: number | undefined; aggregationId: number | undefined; statement: string | null;
}
export function isZkVerifySubmissionConfigured(): boolean { return false; }
export async function submitTutorCertificationProofToZkVerify(_tutorId: string): Promise<ZkVerifySubmissionResult> {
  throw new LegacyProofRetiredError();
}
