import Elysia, { t } from 'elysia';
import { createTutorGuard } from '../middleware/auth.middleware';
import { isAllowedTutorMutationOrigin } from '../config/cors';
import { tutorRewardClaims } from '../services/tutorRewards/claims';
import { RewardError } from '../services/tutorRewards/policy';

export const tutorRewardClaimsRoute = new Elysia({ prefix: '/tutor/rewards' })
  .onError(({ error, set, code }) => {
    set.status = error instanceof RewardError ? error.status : ['VALIDATION', 'PARSE'].includes(String(code)) ? 400 : 503;
    return { success: false, error: error instanceof RewardError ? error.message : 'Rewards could not be confirmed. Retry the same claim or refresh its status.' };
  })
  .derive(async ({ cookie, set }) => ({ rewardTutor: await createTutorGuard(cookie, set) }))
  .onBeforeHandle(({ rewardTutor, request, set }) => {
    set.headers['Cache-Control'] = 'private, no-store';
    if (!rewardTutor || rewardTutor.role !== 'tutor') { set.status = 401; return { success: false, error: 'Tutor authentication required.' }; }
    if (request.method !== 'GET' && !isAllowedTutorMutationOrigin(request.headers.get('origin'))) { set.status = 403; return { success: false, error: 'Trusted tutor origin required.' }; }
  })
  .get('/', async ({ rewardTutor }) => ({ success: true, data: await tutorRewardClaims.summary(rewardTutor!.userId) }))
  .post('/quote', async ({ rewardTutor, body }) => ({ success: true, data: await tutorRewardClaims.quote(rewardTutor!.userId, body.token, body.amountUsd) }), {
    body: t.Object({ token: t.String({ pattern: '^0x[0-9a-fA-F]{40}$' }), amountUsd: t.String({ maxLength: 30 }) }),
  })
  .post('/claim', async ({ rewardTutor, body, set }) => {
    const data = await tutorRewardClaims.confirm(rewardTutor!.userId, body.quoteId); set.status = 202; return { success: true, data };
  }, { body: t.Object({ quoteId: t.String({ format: 'uuid' }) }) });
