import {
  maybeIssueTutorCertificationProof,
  tryIssueTutorCertificationProof,
} from './tutorCertificationProof.service';
import {
  isZkVerifySubmissionConfigured,
  persistZkVerifyFailure,
  submitTutorCertificationProofToZkVerify,
} from './zkVerifySubmit.service';

const terminalOrActiveStatuses = new Set(['submitted', 'verified']);

export async function issueAndMaybeSubmitTutorCertificationProof(
  tutorId: string,
  trigger = 'auto'
): Promise<void> {
  const { snapshot, credential } = await maybeIssueTutorCertificationProof(tutorId, trigger);

  if (snapshot.missingRequirements.length > 0) {
    return;
  }

  if (terminalOrActiveStatuses.has(credential.status)) {
    return;
  }

  if (!isZkVerifySubmissionConfigured()) {
    return;
  }

  try {
    await submitTutorCertificationProofToZkVerify(tutorId);
  } catch (error) {
    await persistZkVerifyFailure(tutorId, credential.id, error, trigger);
    throw error;
  }
}

export async function tryIssueAndMaybeSubmitTutorCertificationProof(
  tutorId: string,
  trigger = 'auto'
): Promise<void> {
  try {
    await issueAndMaybeSubmitTutorCertificationProof(tutorId, trigger);
  } catch (error) {
    console.warn('Failed to issue or submit tutor certification proof:', {
      tutorId,
      trigger,
      error: error instanceof Error ? error.message : error,
    });
  }
}

export async function retryTutorCertificationZkVerifySubmission(tutorId: string) {
  await tryIssueTutorCertificationProof(tutorId, 'admin_retry_prepare');
  const { credential } = await maybeIssueTutorCertificationProof(tutorId, 'admin_retry');

  try {
    return await submitTutorCertificationProofToZkVerify(tutorId);
  } catch (error) {
    await persistZkVerifyFailure(tutorId, credential.id, error, 'admin_retry');
    throw error;
  }
}
