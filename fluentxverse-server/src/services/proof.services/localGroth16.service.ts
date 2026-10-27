import { LegacyProofRetiredError } from './legacyProofRetirement';

export interface LocalGroth16ProofResult {
  credentialId: string; artifactDir: string; inputPath: string; witnessPath: string;
  proofPath: string; publicPath: string; verificationKeyPath: string;
  proofHash: string; publicHash: string; verificationKeyHash: string; verified: boolean;
}

export async function generateLocalTutorCertificationProof(_tutorId: string): Promise<LocalGroth16ProofResult> {
  throw new LegacyProofRetiredError();
}
export async function assertLocalProvingToolchain(): Promise<void> {
  throw new LegacyProofRetiredError();
}
