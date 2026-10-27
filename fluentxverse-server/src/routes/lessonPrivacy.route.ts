import Elysia, { t } from 'elysia';
import { verifyAuthToken } from '../utils/jwt';
import { createAdminGuard } from '../middleware/auth.middleware';
import { isAllowedOrigin } from '../config/cors';
import { LessonPrivacyError } from '../services/lessonPrivacy/policy';
import { lessonPrivacyService, type LessonPrivacyService } from '../services/lessonPrivacy/service';
import type { LessonPrivacyRole } from '../../../shared/lessonPrivacy';

const role = t.Union([t.Literal('student'),t.Literal('tutor')]);
const bookingParams = t.Object({ role, bookingId: t.String({ minLength: 1, maxLength: 200 }) });
const idParams = t.Object({ ...bookingParams.properties, id: t.String({ minLength: 1, maxLength: 200 }) });
const fields = <T extends string>(values: T[]) => t.Array(t.Union(values.map(value => t.Literal(value))), { minItems: 1, maxItems: values.length, uniqueItems: true });

export function lessonPrivacyFailure(error: unknown, code = '') {
  const status = error instanceof LessonPrivacyError ? error.status : code === 'VALIDATION' ? 422 : code === 'PARSE' ? 400 : code === 'NOT_FOUND' ? 404 : 503;
  return { status, body: { success: false, error: error instanceof LessonPrivacyError ? error.message
    : ['VALIDATION','PARSE'].includes(code) ? 'Invalid private lesson request.' : 'Private lesson information is temporarily unavailable.' } };
}

export function createLessonPrivacyRoutes(service: LessonPrivacyService = lessonPrivacyService) {
  async function authenticated(cookie: any, set: any, role: LessonPrivacyRole) {
    const raw = role === 'student' ? cookie.studentAuth?.value : cookie.tutorAuth?.value;
    const auth = raw ? await verifyAuthToken(String(raw)) : null;
    if (!auth || auth.role !== role) { set.status = 401; return null; }
    return auth;
  }
  async function response(set: any, action: () => Promise<unknown> | unknown) {
    try { return { success: true, data: await action() }; }
    catch (error) {
      const failure = lessonPrivacyFailure(error);
      set.status = failure.status;
      return failure.body;
    }
  }
  return new Elysia({ prefix: '/lesson-privacy' })
    .onRequest(({ request, set }) => {
      if (!new URL(request.url).pathname.startsWith('/lesson-privacy/')) return;
      set.headers['Cache-Control'] = 'no-store';
      const origin = request.headers.get('origin');
      if (!['GET','HEAD','OPTIONS'].includes(request.method) && (!origin || !isAllowedOrigin(origin))) {
        set.status = 403;
        return { success: false, error: 'An allowed browser origin is required.' };
      }
    })
    .onError(({ request, error, code, set }) => {
      if (!new URL(request.url).pathname.startsWith('/lesson-privacy/')) return;
      const failure = lessonPrivacyFailure(error,String(code)); set.status = failure.status;
      set.headers['Cache-Control'] = 'no-store'; return failure.body;
    })
    .get('/issuer', ({ set }) => response(set, () => service.issuer()))
    .get('/:role/:bookingId/evidence', async ({ params, cookie, set }) => {
      const auth = await authenticated(cookie,set,params.role);
      if (!auth) return { success: false, error: 'Not authenticated' };
      return response(set, () => service.evidenceOptions(params.bookingId,auth.userId,params.role));
    }, { params: bookingParams })
    .post('/:role/:bookingId/evidence', async ({ params, cookie, set, body }) => {
      const auth = await authenticated(cookie,set,params.role);
      if (!auth) return { success: false, error: 'Not authenticated' };
      return response(set, () => service.createEvidence(params.bookingId,auth.userId,params.role,body));
    }, { params: bookingParams, body: t.Object({ fields: fields(['attendance','overlap','cancellation']) }) })
    .put('/:role/:bookingId/evidence/:id/support', async ({ params, cookie, set, body }) => {
      const auth = await authenticated(cookie,set,params.role);
      if (!auth) return { success: false, error: 'Not authenticated' };
      return response(set, () => service.supportConsent(params.bookingId,auth.userId,params.role,params.id,body.shared));
    }, { params: idParams, body: t.Object({ shared: t.Boolean() }) })
    .get('/admin/reports/:role/:id/evidence', async ({ params, cookie, set }) => {
      const auth = await createAdminGuard(cookie,set,'support');
      if (!auth) return { success: false, error: 'Support permission required' };
      return response(set, () => service.supportEvidence(params.role,params.id,auth.userId));
    }, { params: t.Object({ role,id: t.String({ minLength: 1,maxLength: 200 }) }) });
}
export default createLessonPrivacyRoutes();
