import Elysia, { t } from 'elysia';
import { createAdminGuard, createTutorGuard } from '../middleware/auth.middleware';
import { isAllowedAdminMutationOrigin } from '../config/cors';
import { checkRateLimit } from '../utils/rateLimiter';
import { agentRegistration, screeningPayloadBytes, screeningChainConfig } from '../services/screening/chain';
import { policyHash, schemaHash, screeningPolicy } from '../services/screening/policy';
import { privacyInfrastructure } from '../services/proof.services/horizenReceipt';
import { getScreeningCredential, listScreeningCredentials } from '../services/screening/repository';
import { currentPrivateSummary, finalizeScreeningValidation, generateScreeningProof, issueScreeningCredential, publicScreeningSummary, registerScreeningAgent, requestScreeningValidation, revokeScreeningCredential, shareScreeningCredential, submitScreeningProof } from '../services/screening/service';

const commitment = t.String({ pattern: '^[1-9][0-9]{0,76}$' });
const params = t.Object({ commitment });
async function adminMutation(context: any, action: (actor: string) => Promise<unknown>, requiresCertification = true) {
  if (!isAllowedAdminMutationOrigin(context.request.headers.get('origin'))) {
    context.set.status = 403; return { success: false, error: 'Invalid administration origin' };
  }
  const admin = await createAdminGuard(context.cookie, context.set, 'operations');
  if (!admin) return { success: false, error: 'Operations administrator required' };
  if (!(await checkRateLimit(admin.userId, 'screening')).allowed) { context.set.status = 429; return { success: false, error: 'Screening operation limit reached' }; }
  if (requiresCertification && process.env.SCREENING_ENABLED !== 'true') { context.set.status = 503; return { success: false, error: 'Screening v2 pilot is not enabled' }; }
  try { return { success: true, data: await action(admin.userId) }; }
  catch { context.set.status = 409; return { success: false, error: 'Screening operation could not complete. Check evidence, trust configuration and transaction status.' }; }
}

const Screening = new Elysia({ prefix: '/screening' })
  .onBeforeHandle(({ set }) => { set.headers['Cache-Control'] = 'no-store'; })
  .get('/policy', () => ({ policy: screeningPolicy, policyHash, schemaHash }))
  .get('/agent.json', () => agentRegistration())
  .get('/me', async ({ cookie, set }) => {
    const tutor = await createTutorGuard(cookie, set);
    if (!tutor || tutor.role !== 'tutor') { set.status = tutor ? 403 : 401; return { success: false, error: 'Tutor authentication required' }; }
    return { success: true, data: { enabled: process.env.SCREENING_ENABLED === 'true', policy: screeningPolicy,
      credentials: await Promise.all((await listScreeningCredentials(tutor.userId)).map(currentPrivateSummary)) } };
  })
  .post('/:commitment/share', async ({ cookie, set, body, params, request }) => {
    const origin = request.headers.get('origin');
    const allowed = ['https://tutor.fluentxverse.com', 'https://tutor.fluentxverse.xyz'];
    if (process.env.NODE_ENV !== 'production') allowed.push('http://localhost:5173', 'http://127.0.0.1:5173');
    if (!origin || !allowed.includes(origin)) { set.status = 403; return { success: false, error: 'Invalid tutor origin' }; }
    const tutor = await createTutorGuard(cookie, set);
    if (!tutor || tutor.role !== 'tutor') { set.status = tutor ? 403 : 401; return { success: false, error: 'Tutor authentication required' }; }
    try { return { success: true, data: await shareScreeningCredential(tutor.userId, params.commitment, body.shared) }; }
    catch { set.status = 409; return { success: false, error: 'Sharing could not be updated' }; }
  }, { params, body: t.Object({ shared: t.Boolean() }) })
  .get('/public/:commitment', async ({ params, set }) => {
    const summary = await publicScreeningSummary(params.commitment);
    if (!summary) { set.status = 404; return { success: false, error: 'Shared credential not found' }; }
    return { success: true, data: summary };
  }, { params })
  .get('/tutor/:tutorId', async ({ params, set }) => {
    const latest = (await listScreeningCredentials(params.tutorId)).find(item => item.shared);
    const summary = latest ? await publicScreeningSummary(latest.commitment) : null;
    if (!summary) { set.status = 404; return { success: false, error: 'Shared credential not found' }; }
    return { success: true, data: summary };
  }, { params: t.Object({ tutorId: t.String({ minLength: 1, maxLength: 128 }) }) })
  .get('/request/:commitment', async ({ params, set }) => {
    const stored = await getScreeningCredential(params.commitment);
    if (!stored?.shared) { set.status = 404; return { success: false, error: 'Shared credential not found' }; }
    try {
      const payload = screeningPayloadBytes(screeningChainConfig(), JSON.parse(stored.publicSignals));
      return new Response(Buffer.from(payload.slice(2), 'hex'), { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
    } catch { set.status = 503; return { success: false, error: 'Validation payload unavailable' }; }
  }, { params })
  .post('/admin/register-agent', context => adminMutation(context, registerScreeningAgent, false))
  .post('/admin/issue/:tutorId', context => adminMutation(context, actor => issueScreeningCredential(context.params.tutorId, actor)), {
    params: t.Object({ tutorId: t.String({ minLength: 1, maxLength: 128 }) }) })
  .post('/admin/:commitment/prove', context => adminMutation(context, actor => generateScreeningProof(context.params.commitment, actor)), { params })
  .post('/admin/:commitment/submit', context => adminMutation(context, actor => submitScreeningProof(context.params.commitment, actor)), { params })
  .post('/admin/:commitment/request-validation', context => adminMutation(context, actor => requestScreeningValidation(context.params.commitment, actor)), { params })
  .post('/admin/:commitment/certify', context => adminMutation(context, actor => finalizeScreeningValidation(context.params.commitment, context.body, actor)), {
    params, body: t.Object({ aggregationId: t.String({ pattern: '^([1-9][0-9]{0,19})$' }),
      merklePath: t.Array(t.String({ pattern: '^0x[a-fA-F0-9]{64}$' }), { maxItems: 64 }),
      leafCount: t.String({ pattern: '^[1-9][0-9]{0,19}$' }), index: t.String({ pattern: '^(0|[1-9][0-9]{0,19})$' }) }) })
  .post('/admin/:commitment/revoke', context => adminMutation(context, actor => revokeScreeningCredential(context.params.commitment, actor)), { params });

export default Screening;
