import Elysia from 'elysia';
import {
  getPublicTutorCertificationCredential,
  getTutorCertificationProofStatus,
  maybeIssueTutorCertificationProof,
} from '../services/proof.services/tutorCertificationProof.service';
import { generateLocalTutorCertificationProof } from '../services/proof.services/localGroth16.service';
import { submitTutorCertificationProofToZkVerify } from '../services/proof.services/zkVerifySubmit.service';
import { refreshJwtCookie, verifyAuthToken } from '../utils/jwt';
import { claimStudentLessonProof, getPublicStudentLessonProof, listStudentLessonProofs } from '../services/proof.services/studentLessonProof.service';

const Proof = new Elysia({ prefix: '/proof' })
  .get('/student-lessons/public/:commitment', async ({ params, set }) => {
    if (!/^\d{1,78}$/.test(params.commitment)) {
      set.status = 400;
      return { success: false, error: 'Invalid commitment' };
    }
    const result = await getPublicStudentLessonProof(params.commitment);
    if (!result) {
      set.status = 404;
      return { success: false, error: 'Proof not found' };
    }
    return { success: true, data: result };
  })
  .get('/student-lessons/me', async ({ cookie, set }) => {
    const payload = cookie.studentAuth?.value ? await verifyAuthToken(String(cookie.studentAuth.value)) : null;
    if (!payload) {
      set.status = 401;
      return { success: false, error: 'Authentication required' };
    }
    await refreshJwtCookie(cookie, payload, 'studentAuth');
    return { success: true, data: await listStudentLessonProofs(payload.userId) };
  })
  .post('/student-lessons/:bookingId/claim', async ({ cookie, params, set }) => {
    const payload = cookie.studentAuth?.value ? await verifyAuthToken(String(cookie.studentAuth.value)) : null;
    if (!payload) {
      set.status = 401;
      return { success: false, error: 'Authentication required' };
    }
    await refreshJwtCookie(cookie, payload, 'studentAuth');
    if (!params.bookingId || params.bookingId.length > 128) {
      set.status = 400;
      return { success: false, error: 'Invalid booking' };
    }
    try {
      return { success: true, data: await claimStudentLessonProof(payload.userId, params.bookingId) };
    } catch (error) {
      console.error('Student lesson proof claim failed:', error);
      set.status = error instanceof Error && /Booking not found|Tutor-confirmed attendance/.test(error.message) ? 400 : 500;
      return { success: false, error: set.status === 400 ? (error as Error).message : 'Proof generation failed. Please try again later.' };
    }
  })
  /**
   * Public credential lookup by commitment.
   * GET /proof/tutor-certification/public/:credentialCommitment
   */
  .get('/tutor-certification/public/:credentialCommitment', async ({ params, set }) => {
    try {
      const credentialCommitment = decodeURIComponent(params.credentialCommitment || '');
      if (!credentialCommitment) {
        set.status = 400;
        return { success: false, error: 'credentialCommitment is required' };
      }

      const result = await getPublicTutorCertificationCredential(credentialCommitment);
      if (!result) {
        set.status = 404;
        return { success: false, error: 'Credential not found' };
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('Error in GET /proof/tutor-certification/public/:credentialCommitment:', error);
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get public certification credential',
      };
    }
  })

  /**
   * Tutor-facing proof status.
   * GET /proof/tutor-certification/me
   */
  .get('/tutor-certification/me', async ({ cookie, set }) => {
    const raw = cookie.tutorAuth?.value;
    if (!raw) {
      set.status = 401;
      return { success: false, error: 'Authentication required' };
    }

    const payload = await verifyAuthToken(String(raw));
    if (!payload) {
      set.status = 401;
      return { success: false, error: 'Invalid or expired token' };
    }

    await refreshJwtCookie(cookie, payload, 'tutorAuth');

    try {
      const status = await getTutorCertificationProofStatus(payload.userId);
      return {
        success: true,
        data: status,
      };
    } catch (error) {
      console.error('Error in GET /proof/tutor-certification/me:', error);
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get certification proof status',
      };
    }
  })

  /**
   * Idempotent manual trigger for the authenticated tutor.
   * POST /proof/tutor-certification/maybe-issue
   */
  .post('/tutor-certification/maybe-issue', async ({ cookie, set }) => {
    const raw = cookie.tutorAuth?.value;
    if (!raw) {
      set.status = 401;
      return { success: false, error: 'Authentication required' };
    }

    const payload = await verifyAuthToken(String(raw));
    if (!payload) {
      set.status = 401;
      return { success: false, error: 'Invalid or expired token' };
    }

    await refreshJwtCookie(cookie, payload, 'tutorAuth');

    try {
      const result = await maybeIssueTutorCertificationProof(payload.userId, 'manual_tutor_trigger');
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('Error in POST /proof/tutor-certification/maybe-issue:', error);
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to issue certification proof',
      };
    }
  })

  /**
   * Generate and locally verify a Groth16 proof for the authenticated tutor.
   * This does not submit to zkVerify.
   * POST /proof/tutor-certification/generate-local
   */
  .post('/tutor-certification/generate-local', async ({ cookie, set }) => {
    const raw = cookie.tutorAuth?.value;
    if (!raw) {
      set.status = 401;
      return { success: false, error: 'Authentication required' };
    }

    const payload = await verifyAuthToken(String(raw));
    if (!payload) {
      set.status = 401;
      return { success: false, error: 'Invalid or expired token' };
    }

    await refreshJwtCookie(cookie, payload, 'tutorAuth');

    try {
      const result = await generateLocalTutorCertificationProof(payload.userId);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('Error in POST /proof/tutor-certification/generate-local:', error);
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate local certification proof',
      };
    }
  })

  /**
   * Submit the authenticated tutor's locally generated Groth16 proof to zkVerify.
   * POST /proof/tutor-certification/submit-zkverify
   */
  .post('/tutor-certification/submit-zkverify', async ({ cookie, set }) => {
    const raw = cookie.tutorAuth?.value;
    if (!raw) {
      set.status = 401;
      return { success: false, error: 'Authentication required' };
    }

    const payload = await verifyAuthToken(String(raw));
    if (!payload) {
      set.status = 401;
      return { success: false, error: 'Invalid or expired token' };
    }

    await refreshJwtCookie(cookie, payload, 'tutorAuth');

    try {
      const result = await submitTutorCertificationProofToZkVerify(payload.userId);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('Error in POST /proof/tutor-certification/submit-zkverify:', error);
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to submit certification proof to zkVerify',
      };
    }
  });

export default Proof;
