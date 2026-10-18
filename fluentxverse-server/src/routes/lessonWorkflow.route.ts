import Elysia, { t } from 'elysia';
import { verifyAuthToken } from '../utils/jwt';
import { createAdminGuard } from '../middleware/auth.middleware';
import { lessonWorkflowService } from '../services/lessonWorkflow.service';
import { lessonIssueReviewService } from '../services/lessonIssueReview.service';
import { LessonNotesReadOnly } from '../utils/lessonNotesEditWindow';
import { LessonFeedbackInvalid } from '../utils/lessonFeedbackValidation';

async function workflowAdminGuard(cookie: any, set: any) {
  const auth = await createAdminGuard(cookie, set, 'support');
  if (auth && (auth.role === 'admin' || auth.role === 'superadmin')) return auth;
  if (auth) set.status = 403;
  return null;
}

const Workflow = new Elysia({ prefix: '/lesson-workflow' })
  .onError(({ error, set }) => { if (error instanceof Error) { set.status = error instanceof LessonNotesReadOnly ? 403 : 400; return { success: false, error: error.message }; } })
  .get('/tutor/pending', async ({ cookie, set }) => {
    const auth = cookie.tutorAuth?.value ? await verifyAuthToken(String(cookie.tutorAuth.value)) : null;
    if (!auth || auth.role !== 'tutor') { set.status = 401; return { success: false, error: 'Not authenticated' }; }
    return { success: true, data: await lessonWorkflowService.pending(auth.userId) };
  })
  .get('/:role/:bookingId', async ({ params, cookie, set }) => {
    const raw = params.role === 'tutor' ? cookie.tutorAuth?.value : cookie.studentAuth?.value;
    const auth = raw ? await verifyAuthToken(String(raw)) : null;
    if (!auth || auth.role !== params.role) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
    return { success: true, data: await lessonWorkflowService.get(params.bookingId, auth.userId, params.role) };
  }, { params: t.Object({ role: t.Union([t.Literal('tutor'), t.Literal('student')]), bookingId: t.String() }) })
  .get('/:role/:bookingId/continuations', async ({ params, cookie, set }) => {
    const raw = params.role === 'tutor' ? cookie.tutorAuth?.value : cookie.studentAuth?.value;
    const auth = raw ? await verifyAuthToken(String(raw)) : null;
    if (!auth || auth.role !== params.role) { set.status = 401; return { success: false, error: 'Not authenticated' }; }
    return { success: true, data: await lessonWorkflowService.continuations(params.bookingId, auth.userId, params.role) };
  }, { params: t.Object({ role: t.Union([t.Literal('tutor'), t.Literal('student')]), bookingId: t.String() }) })
  .post('/tutor/:bookingId/submit', async ({ params, cookie, set }) => {
    const auth = cookie.tutorAuth?.value ? await verifyAuthToken(String(cookie.tutorAuth.value)) : null;
    if (!auth || auth.role !== 'tutor') { set.status = 401; return { success: false, error: 'Not authenticated' }; }
    // Return expected validation failures here before the application's global error handler masks them.
    try {
      return { success: true, data: await lessonWorkflowService.submit(params.bookingId, auth.userId) };
    } catch (error) {
      if (error instanceof LessonFeedbackInvalid || error instanceof LessonNotesReadOnly) {
        set.status = error instanceof LessonFeedbackInvalid ? 400 : 403;
        return { success: false, error: error.message, ...(error instanceof LessonFeedbackInvalid ? { validation: error.validation } : {}) };
      }
      throw error;
    }
  })
  .get('/admin/reports', async ({ cookie, set }) => {
    if (!await workflowAdminGuard(cookie, set)) return { success: false, error: 'Unauthorized' };
    return { success: true, data: await lessonIssueReviewService.list() };
  })
  .put('/admin/reports/:source/:id', async ({ cookie, set, params, body }) => {
    const admin = await workflowAdminGuard(cookie, set);
    if (!admin) return { success: false, error: 'Unauthorized' };
    if (body.ticketTransactionId && !await createAdminGuard(cookie, set, 'finance')) return { success: false, error: 'Finance permission required' };
    return { success: true, data: await lessonIssueReviewService.review(params.source, params.id, admin.userId, body.status, body.resolution, body.ticketTransactionId) };
  }, { body: t.Object({ status: t.Union([t.Literal('submitted'), t.Literal('under_review'), t.Literal('resolved')]), resolution: t.String({ maxLength: 2000 }), ticketTransactionId: t.Optional(t.String({ maxLength: 200 })) }) })
  .get('/admin/attendance/:bookingId', async ({ cookie, set, params }) => {
    if (!await workflowAdminGuard(cookie, set)) return { success: false, error: 'Unauthorized' };
    return { success: true, data: await lessonIssueReviewService.attendanceHistory(params.bookingId) };
  })
  .put('/admin/attendance/:bookingId', async ({ cookie, set, params, body }) => {
    const admin = await workflowAdminGuard(cookie, set);
    if (!admin) return { success: false, error: 'Unauthorized' };
    await lessonIssueReviewService.correctAttendance(params.bookingId, admin.userId, body.status, body.reason, body.subject);
    return { success: true };
  }, { body: t.Object({ status: t.Union([t.Literal('present'), t.Literal('absent')]), subject: t.Optional(t.Union([t.Literal('student'), t.Literal('tutor')])), reason: t.String({ minLength: 1, maxLength: 1000 }) }) })
  .post('/admin/attendance/:bookingId/restore/:auditId', async ({ cookie, set, params, body }) => {
    const admin = await workflowAdminGuard(cookie, set);
    if (!admin) return { success: false, error: 'Unauthorized' };
    await lessonIssueReviewService.restore(params.bookingId, params.auditId, admin.userId, body.reason);
    return { success: true };
  }, { body: t.Object({ reason: t.String({ minLength: 1, maxLength: 1000 }) }) });
export default Workflow;
