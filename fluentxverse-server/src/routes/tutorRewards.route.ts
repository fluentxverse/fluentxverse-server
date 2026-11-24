import Elysia, { t } from 'elysia';
import { createAdminGuard } from '../middleware/auth.middleware';
import { adminOperationsService } from '../services/admin.services/operations.service';
import { isAllowedAdminMutationOrigin } from '../config/cors';
import { tutorRewardsService } from '../services/tutorRewards/service';
import { RewardError } from '../services/tutorRewards/policy';
import type { RewardCommand } from '../../../shared/tutorRewards';
import { aeroTutorRewards } from '../services/tutorRewards/aero';

export const tutorRewardsRoute = new Elysia({ prefix: '/admin/tutor-rewards' })
  .onError(({ error, set, code }) => {
    set.status = error instanceof RewardError ? error.status : ['VALIDATION', 'PARSE'].includes(String(code)) ? 400 : 503;
    return { success: false, error: error instanceof RewardError ? error.message : 'Rewards could not be checked. No completed transaction is claimed.' };
  })
  .derive(async ({ cookie, set }) => {
    const auth = await createAdminGuard(cookie, set);
    return { rewardsOperator: auth ? await adminOperationsService.access(auth.userId) : null };
  })
  .onBeforeHandle(({ rewardsOperator: actor, set, request }) => {
    set.headers['Cache-Control'] = 'private, no-store';
    if (!actor || !actor.permissions?.includes('finance')) { set.status = 403; return { success: false, error: 'Finance permission required.' }; }
    if (request.method !== 'GET' && (actor.role !== 'superadmin' || !isAllowedAdminMutationOrigin(request.headers.get('origin')))) {
      set.status = 403; return { success: false, error: 'A trusted origin and superadmin approval are required.' };
    }
  })
  .get('/', async () => ({ success: true, data: await tutorRewardsService.summary() }))
  .get('/aero/quote', async ({ query }) => ({ success: true, data: await aeroTutorRewards.quote(query.token, query.amountUsd) }), {
    query: t.Object({ token: t.String({ pattern: '^0x[0-9a-fA-F]{40}$' }), amountUsd: t.String({ maxLength: 30 }) }),
  })
  .get('/preview', async ({ query }) => ({ success: true, data: await tutorRewardsService.preview(query.month) }), { query: t.Object({ month: t.String({ pattern: '^20[2-9][0-9]-(0[1-9]|1[0-2])$' }) }) })
  .post('/commands', async ({ body, rewardsOperator, set }) => {
    const data = await tutorRewardsService.command({ ...body, action: body.action as RewardCommand }, rewardsOperator!.id);
    set.status = 202; return { success: true, data };
  }, { body: t.Object({ action: t.String({ maxLength: 40 }), requestId: t.String({ format: 'uuid' }), reason: t.String({ minLength: 1, maxLength: 1000 }), params: t.Record(t.String(), t.Unknown()) }) });
