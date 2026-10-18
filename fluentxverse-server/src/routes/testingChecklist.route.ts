import Elysia, { t } from 'elysia';
import { createAdminGuard } from '../middleware/auth.middleware';
import { isAllowedAdminMutationOrigin } from '../config/cors';
import { testingChecklistService } from '../services/admin.services/testingChecklist.service';
import { TESTING_RUN, testingChecklist } from '../shared/testingChecklist';

export function createTestingChecklistRoute(service = testingChecklistService, guard = createAdminGuard) {
  return new Elysia({ prefix: '/admin/testing', name: 'admin-testing', normalize: false })
    .onError(({ code, set }) => {
      if (code === 'VALIDATION') { set.status = 400; return { success: false, error: 'Invalid checklist update.' }; }
      set.status = 500;
      return { success: false, error: 'Could not save or load testing progress. Please try again.' };
    })
    .onBeforeHandle(async ({ cookie, set, request }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      if (!await guard(cookie, set)) return { success: false, error: 'Admin authentication required.' };
      if (request.method !== 'GET') {
        if (!isAllowedAdminMutationOrigin(request.headers.get('origin'))) { set.status = 403; return { success: false, error: 'Untrusted origin.' }; }
        if (!await guard(cookie, set, 'operations')) return { success: false, error: 'Operations permission required.' };
      }
    })
    .get('/', async ({ cookie }) => {
      const access: any = { status: 200 };
      return { success: true, data: { runId: TESTING_RUN, canEdit: Boolean(await guard(cookie, access, 'operations')), items: await service.list() } };
    })
    .patch('/:id', async ({ params, body, cookie, set }) => {
      const item = testingChecklist.find(check => check.id === params.id);
      if (!item) { set.status = 404; return { success: false, error: 'Test item not found.' }; }
      if (item.gate && body.completed) { set.status = 409; return { success: false, error: 'This test is gated and cannot be marked passed yet.' }; }
      const actor = await guard(cookie, set, 'operations');
      if (!actor) return { success: false, error: 'Operations permission required.' };
      const data = await service.update(params.id, body, actor.email || actor.userId);
      if (!data) { set.status = 409; return { success: false, error: 'A teammate updated this item. Refresh before saving again.' }; }
      return { success: true, data };
    }, { body: t.Object({ completed: t.Boolean(), notes: t.String({ maxLength: 2000 }), revision: t.Integer({ minimum: 0, maximum: 2147483646 }) }, { additionalProperties: false }) });
}

export const testingChecklistRoute = createTestingChecklistRoute();
