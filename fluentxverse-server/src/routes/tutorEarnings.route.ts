import Elysia, { t } from 'elysia';
import { createAdminGuard } from '../middleware/auth.middleware';
import { isAllowedAdminMutationOrigin } from '../config/cors';
import { tutorEarningsService as earnings } from '../services/admin.services/tutorEarnings.service';
import { tutorCompensationFailure } from '../services/admin.services/tutorCompensation.service';
import { payoutReconciliationRequest, tutorPayoutRecoveryService as recovery } from '../services/admin.services/tutorPayoutRecovery.service';
import { tutorPayoutAuthorizationService as authorization } from '../services/admin.services/tutorPayoutAuthorization.service';

const reason = t.String({ minLength: 1, maxLength: 1000 });
export const tutorEarningsRoute = new Elysia({ prefix: '/admin/operations/compensation', name: 'tutor-earnings', normalize: false })
  .derive(async ({ cookie, set }) => ({ financeOperator: await createAdminGuard(cookie, set, 'finance') }))
  .onBeforeHandle(({ financeOperator, request, set }) => {
    set.headers['Cache-Control'] = 'private, no-store';
    if (!financeOperator) { set.status = 403; return { success: false, error: 'Finance permission required.' }; }
    if (!isAllowedAdminMutationOrigin(request.headers.get('origin'))) { set.status = 403; return { success: false, error: 'Untrusted financial origin.' }; }
  })
  .get('/payout-authorization/readiness', async () => ({ success: true, data: await authorization.readiness() }))
  .get('/:id/payouts/:batchId/authorization', async ({ params, financeOperator }) => ({ success: true, data: await authorization.detail(params.id, params.batchId, financeOperator!.userId) }))
  .post('/:id/payouts/:batchId/authorization', async ({ params, body, financeOperator }) => ({ success: true, data: await authorization.generate(params.id, params.batchId, financeOperator!.userId, body) }), { body: t.Unknown() })
  .post('/:id/payouts/:batchId/authorization/submit', async ({ params, body, financeOperator }) => ({ success: true, data: await authorization.submit(params.id, params.batchId, financeOperator!.userId, body) }), { body: t.Unknown() })
  .post('/:id/payouts/:batchId/authorization/reconcile', async ({ params, body, financeOperator }) => ({ success: true, data: await authorization.reconcile(params.id, params.batchId, financeOperator!.userId, body) }), { body: t.Unknown() })
  .get('/:id/earnings', async ({ params, financeOperator }) => ({ success: true, data: await earnings.list(params.id, financeOperator!.userId) }))
  .post('/:id/earnings/:bookingId', async ({ params, body, financeOperator }) => ({ success: true,
    data: await earnings.post(params.id, params.bookingId, financeOperator!.userId, body.reason) }), {
    body: t.Object({ reason }, { additionalProperties: false }),
  })
  .post('/:id/payouts', async ({ params, body, financeOperator }) => ({ success: true, data: await earnings.reserve(params.id, body, financeOperator!.userId) }), {
    body: t.Object({ requestId: t.String({ format: 'uuid' }), bookingIds: t.Array(t.String({ minLength: 1, maxLength: 128 }), { minItems: 1, maxItems: 4 }),
      recipient: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }), reason }, { additionalProperties: false }),
  })
  .get('/:id/payouts', async ({ params, financeOperator }) => ({ success: true, data: await recovery.list(params.id, financeOperator!.userId) }))
  .get('/:id/payouts/:batchId', async ({ params, financeOperator }) => ({ success: true, data: await recovery.detail(params.id, params.batchId, financeOperator!.userId) }))
  .post('/:id/payouts/:batchId/cancel', async ({ params, body, financeOperator }) => ({ success: true,
    data: await recovery.cancel(params.id, params.batchId, financeOperator!.userId, body) }), {
    // The service validates raw keys; schema cleaning must not hide extra fields.
    body: t.Unknown(),
  })
  .post('/:id/payouts/:batchId/reconcile', async ({ params, body, financeOperator }) => {
    payoutReconciliationRequest(body);
    return { success: true, data: await recovery.reconcile(params.id, params.batchId, financeOperator!.userId) };
  }, {
    // Keep raw keys visible to the explicit validator instead of schema cleaning.
    body: t.Unknown(),
  })
  .get('/:id/payouts/:batchId/evidence', async ({ params, financeOperator }) => ({ success: true, data: await earnings.evidence(params.id, params.batchId, financeOperator!.userId) }))
  .onError(({ error, code, set }) => { const response = tutorCompensationFailure(error, code); set.status = response.status; return response.body; });
