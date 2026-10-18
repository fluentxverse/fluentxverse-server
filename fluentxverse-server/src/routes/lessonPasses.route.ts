import Elysia, { t } from 'elysia';
import { resolveStudentSession } from '../utils/studentSession';
import { createAdminGuard } from '../middleware/auth.middleware';
import { isAllowedAdminMutationOrigin } from '../config/cors';
import { checkRateLimit } from '../utils/rateLimiter';
import { PassError, publicPassMode } from '../services/lessonPasses/policy';
import { LessonPassService, lessonPassService } from '../services/lessonPasses/service';

const id = t.String({ pattern: '^0x[a-f0-9]{64}$' });
const scalar = t.String({ pattern: '^(0|[1-9][0-9]{0,77})$' });
const params = t.Object({ id });
// Preserve extras until the explicit guard rejects them; Elysia otherwise strips them.
const object = <T extends Record<string, any>>(fields: T) => t.Object(fields, { additionalProperties: true });
const origins = ['https://student.fluentxverse.com', 'https://student.fluentxverse.xyz'];
export function createLessonPassRoutes(service: LessonPassService = lessonPassService) {
  async function result(c: any, action: () => Promise<unknown> | unknown) {
    try { return { success: true, data: await action() }; }
    catch (error) { c.set.status = error instanceof PassError ? error.status : 503;
      return { success: false, error: error instanceof PassError ? error.message : 'Pass operation unavailable; reload or contact support before retrying' }; }
  }
  async function student(c: any, action: (userId: string) => Promise<unknown>) {
    return result(c, async () => {
      const origin = c.request.headers.get('origin');
      const local = process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1):517[46]$/.test(origin || '');
      if (c.request.method !== 'GET' && !origins.includes(origin || '') && !local) throw new PassError('Invalid student origin', 403);
      const user = await resolveStudentSession(c.request);
      if (!user) throw new PassError('Student authentication required', 401);
      if (!(await checkRateLimit(user.userId, 'general')).allowed) throw new PassError('Pass request limit reached', 429);
      return action(user.userId);
    });
  }
  async function admin(c: any, action: (operatorId: string) => Promise<unknown>) {
    return result(c, async () => {
      if (!isAllowedAdminMutationOrigin(c.request.headers.get('origin'))) throw new PassError('Invalid administration origin', 403);
      const user = await createAdminGuard(c.cookie, c.set, 'finance');
      if (!user) throw new PassError('Finance administrator required', Number(c.set.status) || 401);
      if (!(await checkRateLimit(user.userId, 'general')).allowed) throw new PassError('Pass operation limit reached', 429);
      return action(user.userId);
    });
  }
  return new Elysia({ prefix: '/lesson-passes', normalize: false })
    .onRequest(async ({ request, set }) => {
      set.headers['Cache-Control'] = 'no-store'; set.headers['Referrer-Policy'] = 'no-referrer';
      if (!request.body) return;
      const reader = request.clone().body!.getReader(); let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 300_000) {
            await Promise.all([reader.cancel(), request.body.cancel()]);
            return new Response(JSON.stringify({ success: false, error: 'Pass request too large' }), { status: 413, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
          }
        }
      } finally { reader.releaseLock(); }
    })
    .onBeforeHandle(({ request, body, set }) => {
      if (request.method === 'GET') return;
      const path = new URL(request.url).pathname;
      const fields = path.endsWith('/vault') ? ['accountId','version','envelope'] : path.endsWith('/orders') ? ['accountId','id','sku','commitments']
        : path.endsWith('/reservations') ? ['id','passId','refundCommitment'] : path.endsWith('/proof') ? ['merkleTreeDepth','merkleTreeRoot','nullifier','message','scope','points']
        : path.endsWith('/approve') ? ['paymentReference','paidCents'] : path.endsWith('/seal') ? ['passIds'] : path.endsWith('/certify') ? ['aggregationId','merklePath','leafCount','index'] : [];
      if (body !== undefined && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key)))) {
        set.status = 400; return { success: false, error: 'Unexpected pass request fields' };
      }
    })
    .onError(({ set, code }) => { set.status = ['VALIDATION','PARSE'].includes(String(code)) ? 400 : 503;
      return { success: false, error: 'Pass request could not be processed' }; })
    .get('/mode', c => result(c, publicPassMode))
    .get('/me', c => student(c, user => service.mine(user)))
    .put('/vault', c => student(c, user => { if (user !== c.body.accountId) throw new PassError('Student account changed', 409); return service.saveVault(user, c.body.version, c.body.envelope); }), {
      body: object({ accountId: t.String({ minLength: 1, maxLength: 128 }), version: t.Integer({ minimum: 0 }), envelope: t.String({ maxLength: 262144 }) }) })
    .post('/orders', c => student(c, user => { if (user !== c.body.accountId) throw new PassError('Student account changed', 409); return service.order(user, c.body.id, c.body.sku, c.body.commitments); }), {
      body: object({ accountId: t.String({ minLength: 1, maxLength: 128 }), id, sku: t.Union([t.Literal('basic-1'),t.Literal('basic-30')]), commitments: t.Array(scalar, { minItems: 1, maxItems: 30 }) }) })
    .get('/batch/:id', c => student(c, () => service.batch(c.params.id)), { params })
    .post('/reservations', c => student(c, user => service.prepare(user, c.body.passId, c.body.id, c.body.refundCommitment)), {
      body: object({ id, passId: t.String({ minLength: 1, maxLength: 180 }), refundCommitment: scalar }) })
    .post('/reservations/:id/proof', c => student(c, user => service.proof(user, c.params.id, c.body)), { params,
      body: object({ merkleTreeDepth: t.Literal(8), merkleTreeRoot: scalar, nullifier: scalar, message: scalar, scope: scalar,
        points: t.Array(scalar, { minItems: 8, maxItems: 8 }) }) })
    .post('/reservations/:id/return', c => student(c, user => service.returnUnused(user, c.params.id)), { params })
    .post('/reservations/:id/recover', c => student(c, user => service.recoverUnused(user, c.params.id)), { params })
    .get('/admin/queue', c => admin(c, () => service.repository.queue()))
    .post('/admin/orders/:id/approve', c => admin(c, operator => service.approve(c.params.id, c.body.paymentReference, c.body.paidCents, operator)), { params,
      body: object({ paymentReference: t.String({ minLength: 8, maxLength: 128 }), paidCents: t.Integer({ minimum: 1 }) }) })
    .post('/admin/batches/:id/seal', c => admin(c, () => service.seal(c.params.id, c.body.passIds)), { params,
      body: object({ passIds: t.Array(t.String({ minLength: 1, maxLength: 180 }), { minItems: 1, maxItems: 256 }) }) })
    .post('/admin/batches/:id/register', c => admin(c, () => service.register(c.params.id)), { params })
    .post('/admin/reservations/:id/submit', c => admin(c, () => service.submit(c.params.id)), { params })
    .post('/admin/reservations/:id/certify', c => admin(c, () => service.certify(c.params.id, c.body)), { params,
      body: object({ aggregationId: scalar, merklePath: t.Array(id, { maxItems: 64 }), leafCount: scalar, index: scalar }) })
    .post('/admin/reservations/:id/reconcile', c => admin(c, () => service.reconcile(c.params.id)), { params })
    .post('/admin/reservations/:id/finalize', c => admin(c, () => service.finalize(c.params.id)), { params });
}
export default createLessonPassRoutes();
