import { getTutorCertificationProofStatus } from './tutorCertificationProof.service';
import { LegacyProofRetiredError } from './legacyProofRetirement';
import { getDriver } from '../../db/memgraph';

// Application approval remains separate from cryptographic certification.
export async function issueAndMaybeSubmitTutorCertificationProof(tutorId: string, _trigger = 'auto'): Promise<void> {
  const { snapshot } = await getTutorCertificationProofStatus(tutorId);
  if (snapshot.missingRequirements.length) return;
  const session = getDriver().session();
  try {
    await session.run("MATCH (u:User {id: $tutorId}) SET u.certificationStatus = 'certified', u.certificationStatusUpdatedAt = $now",
      { tutorId, now: new Date().toISOString() });
  } finally { await session.close(); }
}
export async function tryIssueAndMaybeSubmitTutorCertificationProof(tutorId: string, trigger = 'auto'): Promise<void> {
  try { await issueAndMaybeSubmitTutorCertificationProof(tutorId, trigger); }
  catch { console.warn('Could not refresh tutor application approval', { trigger }); }
}
export async function retryTutorCertificationZkVerifySubmission(_tutorId: string): Promise<never> {
  throw new LegacyProofRetiredError();
}
