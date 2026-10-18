import Elysia, { t } from 'elysia';
import { resolveStudentSession } from '../utils/studentSession';
import { createAdminGuard } from '../middleware/auth.middleware';
import { isAllowedAdminMutationOrigin } from '../config/cors';
import { checkRateLimit } from '../utils/rateLimiter';
import { AnonymousReviewError, requireAnonymousReviews } from '../services/anonymousReviews/policy';
import { parseReviewProof } from '../services/anonymousReviews/policy';
import { validateAnonymousContent } from '../shared/anonymousReviews';
import { anonymousReviewService, type AnonymousReviewService } from '../services/anonymousReviews/service';

const id = t.String({ pattern: '^0x[a-fA-F0-9]{64}$' });
const scalar = t.String({ pattern: '^(0|[1-9][0-9]{0,77})$' });
const originAllowed = (origin: string | null) => Boolean(origin && (['https://student.fluentxverse.com', 'https://student.fluentxverse.xyz'].includes(origin)
  || (process.env.NODE_ENV !== 'production' && ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5176', 'http://127.0.0.1:5176'].includes(origin))));

export function createAnonymousReviewRoutes(service: AnonymousReviewService = anonymousReviewService) {
  async function result(context: any, action: () => Promise<unknown>) {
    try { requireAnonymousReviews(); return { success: true, data: await action() }; }
    catch (error) {
      context.set.status = error instanceof AnonymousReviewError ? error.status : 503;
      return { success: false, error: error instanceof AnonymousReviewError ? error.message : 'Review operation unavailable; please try again later' };
    }
  }
  async function student(context: any, action: (studentId: string) => Promise<unknown>) {
    return result(context, async () => {
      if (context.request.method !== 'GET' && !originAllowed(context.request.headers.get('origin'))) throw new AnonymousReviewError('Invalid student origin', 403);
      const payload = await resolveStudentSession(context.request);
      if (!payload) throw new AnonymousReviewError('Student authentication required', 401);
      if (!(await checkRateLimit(payload.userId, 'screening')).allowed) throw new AnonymousReviewError('Enrollment limit reached', 429);
      return action(payload.userId);
    });
  }
  async function admin(context: any, action: () => Promise<unknown>) {
    return result(context, async () => {
      if (!isAllowedAdminMutationOrigin(context.request.headers.get('origin'))) throw new AnonymousReviewError('Invalid administration origin', 403);
      const operator = await createAdminGuard(context.cookie, context.set, 'operations');
      if (!operator) throw new AnonymousReviewError('Operations administrator required', Number(context.set.status) || 401);
      if (!(await checkRateLimit(operator.userId, 'screening')).allowed) throw new AnonymousReviewError('Review operation limit reached', 429);
      return action();
    });
  }
  async function anonymous(context: any, action: () => Promise<unknown>) {
    return result(context, async () => {
      // Do not silently downgrade to "anonymous" while accepting account cookies.
      if (context.request.headers.has('cookie') || context.request.headers.has('authorization'))
        throw new AnonymousReviewError('Submit without cookies or authorization', 400);
      if (!originAllowed(context.request.headers.get('origin'))) throw new AnonymousReviewError('Invalid review origin', 403);
      if (!(await checkRateLimit('anonymous-review-public-pilot', 'general')).allowed) throw new AnonymousReviewError('Review relay is busy; try again later', 429);
      return action();
    });
  }
  return new Elysia({ prefix: '/anonymous-reviews', normalize: false })
    .onRequest(async ({ request, set }) => {
      set.headers['Cache-Control'] = 'no-store'; set.headers['Referrer-Policy'] = 'no-referrer';
      if (!request.body) return;
      const reader = request.clone().body!.getReader();
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 16_384) {
            await Promise.all([reader.cancel(), request.body.cancel()]); set.status = 413;
            return new Response(JSON.stringify({ success: false, error: 'Review request too large' }), { status: 413, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
          }
        }
      } finally { reader.releaseLock(); }
    })
    .onBeforeHandle(({ request, set }) => {
      set.headers['Cache-Control'] = 'no-store'; set.headers['Referrer-Policy'] = 'no-referrer';
      if (Number(request.headers.get('content-length') || 0) > 16_384) {
        set.status = 413; return { success: false, error: 'Review request too large' };
      }
    })
    .get('/me', context => student(context, user => service.mine(user)))
    .get('/lesson/:bookingId', context => student(context, user => service.forLesson(context.params.bookingId, user)), {
      params: t.Object({ bookingId: t.String({ minLength: 1, maxLength: 128 }) }) })
    .post('/enroll/:bookingId', context => student(context, user => service.enroll(context.params.bookingId, user, context.body.commitment)), {
      params: t.Object({ bookingId: t.String({ minLength: 1, maxLength: 128 }) }), body: t.Object({ commitment: scalar }, { additionalProperties: false }) })
    .get('/public/group/:id', context => result(context, () => service.group(context.params.id)), { params: t.Object({ id }) })
    .get('/public/summary/:id', context => result(context, () => service.summary(context.params.id)), { params: t.Object({ id }) })
    .get('/public/tally/:id', context => result(context, () => service.tally.publicEvidence(context.params.id)), { params: t.Object({ id }) })
    .get('/public/tutor/:tutorId', async ({ params, set }) => {
      try { return { success: true, data: await service.tutorSummaries(params.tutorId) }; }
      catch { set.status = 503; return { success: false, error: 'Verified feedback is unavailable' }; }
    }, { params: t.Object({ tutorId: t.String({ minLength: 1, maxLength: 128 }) }) })
    .post('/public/status', context => anonymous(context, () => service.status(context.body.id)), { body: t.Object({ id }, { additionalProperties: false }) })
    .post('/public/submit', context => anonymous(context, () => {
      if (Object.keys(context.body).some(key => !['groupId', 'content', 'proof'].includes(key))) throw new AnonymousReviewError('Unexpected review fields');
      try { validateAnonymousContent(context.body.content); } catch (error) { throw new AnonymousReviewError((error as Error).message); }
      parseReviewProof(context.body.proof);
      return service.receive(context.body.groupId, context.body.content, context.body.proof);
    }), {
      body: t.Object({ groupId: id, content: t.Object({ rating: t.Integer({ minimum: 1, maximum: 5 }),
        positive: t.Array(t.String({ maxLength: 32 }), { maxItems: 6 }), improvement: t.Array(t.String({ maxLength: 32 }), { maxItems: 6 }),
        salt: t.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: true }),
        proof: t.Object({ merkleTreeDepth: t.Literal(8), merkleTreeRoot: scalar, nullifier: scalar, message: scalar, scope: scalar,
          points: t.Array(scalar, { minItems: 8, maxItems: 8 }) }, { additionalProperties: true }) }, { additionalProperties: true }) })
    .post('/admin/group/:id/activate', context => admin(context, () => service.activate(context.params.id)), { params: t.Object({ id }) })
    .post('/admin/review/:id/submit', context => admin(context, () => service.submit(context.params.id)), { params: t.Object({ id }) })
    .post('/admin/review/:id/reconcile', context => admin(context, () => service.reconcile(context.params.id)), { params: t.Object({ id }) })
    .post('/admin/review/:id/certify', context => admin(context, () => service.certify(context.params.id, context.body)), { params: t.Object({ id }),
      body: t.Object({ aggregationId: scalar, merklePath: t.Array(t.String({ pattern: '^0x[a-fA-F0-9]{64}$' }), { maxItems: 64 }),
        leafCount: scalar, index: scalar }, { additionalProperties: false }) })
    .post('/admin/group/:id/tally/prepare', context => admin(context, () => service.tally.prepare(context.params.id)), { params: t.Object({ id }) })
    .post('/admin/group/:id/tally/prove', context => admin(context, () => service.tally.prove(context.params.id)), { params: t.Object({ id }) })
    .post('/admin/group/:id/tally/submit', context => admin(context, () => service.tally.submit(context.params.id)), { params: t.Object({ id }) })
    .post('/admin/group/:id/tally/certify', context => admin(context, () => service.tally.certify(context.params.id, context.body)), { params: t.Object({ id }),
      body: t.Object({ aggregationId: scalar, merklePath: t.Array(t.String({ pattern: '^0x[a-fA-F0-9]{64}$' }), { maxItems: 64 }),
        leafCount: scalar, index: scalar }, { additionalProperties: false }) })
    .post('/admin/group/:id/publish', context => admin(context, () => service.publish(context.params.id)), { params: t.Object({ id }) });
}
export default createAnonymousReviewRoutes();
