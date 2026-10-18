import Elysia, { t } from 'elysia';
import { createAdminGuard } from '../middleware/auth.middleware';
import { adminOperationsService as ops } from '../services/admin.services/operations.service';
import { lessonIssueReviewService as issues } from '../services/lessonIssueReview.service';
import { isAllowedAdminMutationOrigin } from '../config/cors';
import { tutorCompensationService as compensation, tutorCompensationFailure } from '../services/admin.services/tutorCompensation.service';

const reason = t.String({ minLength: 1, maxLength: 1000 });
export const adminOperationsRoute = new Elysia({ prefix: '/admin/operations' })
  .derive(async ({ cookie, set }) => {
    const auth = await createAdminGuard(cookie, set);
    return { operator: auth ? await ops.access(auth.userId) : null };
  })
  .onBeforeHandle(({ operator, set, request }) => {
    set.headers['Cache-Control'] = 'private, no-store';
    if (!operator) { set.status = 403; return { success: false, error: 'Administrator access required' }; }
    const path = new URL(request.url).pathname, method = request.method;
    if ((method !== 'GET' || path.includes('/compensation')) && !isAllowedAdminMutationOrigin(request.headers.get('origin'))) {
      set.status = 403; return { success: false, error: 'Untrusted origin' };
    }
    const cap = path.includes('/payments') || path.includes('/compensation') || path.endsWith('/refund') ? 'finance'
      : path.includes('/surveys') ? 'qa'
      : path.endsWith('/schedule') || path.endsWith('/revoke') || path.endsWith('/unblock') ? 'operations'
      : path.includes('/reports') || path.endsWith('/reopen') ? 'support' : null;
    if ((cap && !operator.permissions.includes(cap)) || (method !== 'GET' && path.endsWith('/permissions') && operator.role !== 'superadmin')) {
      set.status = 403; return { success: false, error: 'You do not have permission for this action' };
    }
  })
  .get('/access', ({ operator }) => ({ success: true, data: operator }))
  .get('/compensation', async ({ query }) => ({ success: true, data: await compensation.summaries(query.tutorIds.split(',')) }), {
    query: t.Object({ tutorIds: t.String({ minLength: 1, maxLength: 6500 }) }),
  })
  .get('/compensation/:id', async ({ params, query }) => ({ success: true,
    data: await compensation.detail(params.id, query.beforeVersion === undefined ? undefined : Number(query.beforeVersion)) }), {
    query: t.Object({ beforeVersion: t.Optional(t.String({ pattern: '^[1-9][0-9]{0,15}$' })) }),
  })
  .put('/compensation/:id', async ({ params, body, operator }) => ({ success: true, data: await compensation.save(params.id, body, operator!.id) }), {
    body: t.Object({ amount: t.String({ minLength: 1, maxLength: 12 }), currency: t.Literal('USD'),
      expectedVersion: t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 }), requestId: t.String({ format: 'uuid' }), reason: t.String({ maxLength: 1000 }) }),
  })
  .get('/lessons', async ({ query }) => ({ success: true, data: await ops.list({ ...query, page: Number(query.page || 1) }) }))
  .get('/slots', async ({ query }) => ({ success: true, data: await ops.slots(query.from, query.to, query.tutorId) }))
  .get('/lessons/:id', async ({ params, operator }) => ({ success: true, data: await ops.detail(params.id, operator!.permissions) }))
  .get('/surveys', async ({ query }) => ({ success: true, data: await ops.surveys(query.from, query.to, query.tutorId, true) }))
  .get('/performance/:id', async ({ params, query }) => ({ success: true, data: await ops.metrics(params.id, query.period || 'month', query.month, Number(query.page || 1)) }))
  .get('/people/:role/:id', async ({ params, operator }) => ({ success: true, data: await ops.people(params.role, params.id, operator!.permissions) }))
  .get('/audit', async ({ query }) => ({ success: true, data: await ops.audits(query.subjectId) }))
  .get('/payments', async ({ query }) => ({ success: true, data: await ops.payments(query.from, query.to) }))
  .get('/penalties/:id/preview', async ({ params }) => ({ success: true, data: await ops.penaltyPreview(params.id) }))
  .get('/admins', async () => ({ success: true, data: await ops.admins() }))
  .patch('/admins/:id/permissions', async ({ params, body, operator }) => {
    await ops.permissions(params.id, operator!.id, body.permissions, body.reason); return { success: true };
  }, { body: t.Object({ permissions: t.Array(t.String()), reason }) })
  .post('/lessons/:id/reopen', async ({ params, body, operator }) => {
    await ops.reopen(params.id, operator!.id, body.hours, body.reason); return { success: true };
  }, { body: t.Object({ hours: t.Integer({ minimum: 1, maximum: 168 }), reason }) })
  .post('/lessons/:id/schedule', async ({ params, body, operator }) => {
    await ops.schedule(params.id, operator!.id, body.action, body.reason, body.targetSlotId); return { success: true };
  }, { body: t.Object({ action: t.Union([t.Literal('cancel'), t.Literal('reschedule')]), reason, targetSlotId: t.Optional(t.String()) }) })
  .post('/lessons/:id/refund', async ({ params, body, operator }) => ({ success: true, data: await ops.refund(params.id, operator!.id, body.reason) }), { body: t.Object({ reason }) })
  .post('/penalties/:id/revoke', async ({ params, body, operator }) => {
    await ops.changePenalty(params.id, operator!.id, body.reason); return { success: true };
  }, { body: t.Object({ reason }) })
  .post('/tutors/:id/unblock', async ({ params, body, operator }) => {
    await ops.unblock(params.id, operator!.id, body.reason); return { success: true };
  }, { body: t.Object({ reason }) })
  .get('/reports', async () => ({ success: true, data: await issues.list() }))
  .patch('/reports/:source/:id', async ({ params, body, operator }) => ({ success: true, data: await issues.updateCase(params.source, params.id, operator!.id, body.assigneeId, body.priority, body.comment) }), {
    body: t.Object({ assigneeId: t.String(), priority: t.Union([t.Literal('normal'), t.Literal('high'), t.Literal('urgent')]), comment: t.String({ minLength: 1, maxLength: 2000 }) }),
  })
  .put('/reports/:source/:id/review', async ({ params, body, operator, cookie, set }) => {
    if (body.ticketTransactionId && !await createAdminGuard(cookie, set, 'finance')) return { success: false, error: 'Finance permission required' };
    return { success: true, data: await issues.review(params.source, params.id, operator!.id, body.status, body.resolution, body.ticketTransactionId) };
  }, { body: t.Object({ status: t.Union([t.Literal('submitted'), t.Literal('under_review'), t.Literal('resolved')]), resolution: t.String({ maxLength: 2000 }), ticketTransactionId: t.Optional(t.String()) }) })
  .onError(({ error, set, path, code }) => {
    if (path.includes('/compensation')) {
      const response = tutorCompensationFailure(error, code);
      set.status = response.status;
      return response.body;
    }
    if (Number(set.status || 200) < 400) set.status = 400;
    return { success: false, error: error instanceof Error ? error.message : 'Operation failed' };
  });
