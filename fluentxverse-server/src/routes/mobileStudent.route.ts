import Elysia, { t } from 'elysia';
import { MobileAuthError, type MobileAccount, type MobileAuthService } from '../services/auth.services/mobileAuth.service';

export interface MobileStudentDependencies {
  auth(): MobileAuthService;
  login(email: string, password: string): Promise<MobileAccount>;
  profile(userId: string): Promise<unknown>;
  stats(userId: string): Promise<unknown>;
  bookings(userId: string): Promise<unknown>;
  rateLimit(request: Request, set: any, kind: 'auth' | 'general'): Promise<unknown>;
}

export function mobileStudentFailure(error: unknown, code?: string) {
  const status = error instanceof MobileAuthError ? error.status
    : code === 'VALIDATION' || code === 'PARSE' ? 400 : code === 'NOT_FOUND' ? 404 : 503;
  const message = error instanceof MobileAuthError ? error.message
    : status === 400 ? 'Invalid mobile request.' : status === 404 ? 'Mobile endpoint not found.'
      : 'The mobile service is temporarily unavailable.';
  return { status, body: { success: false, error: message } };
}

export function createMobileStudentRoutes(deps: MobileStudentDependencies) {
  const refreshBody = t.Object({ refreshToken: t.String({ minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' }) });
  const protectedRead = async (request: Request, read: (userId: string) => Promise<unknown>) => {
    const user = await deps.auth().authenticate(request.headers.get('authorization'));
    return { success: true, data: await read(user.userId) };
  };
  return new Elysia({ name: 'mobile-student', prefix: '/mobile/student' })
    .onBeforeHandle(async ({ request, set }) => {
      set.headers['Cache-Control'] = 'no-store';
      set.headers['Pragma'] = 'no-cache';
      set.headers['Vary'] = 'Authorization';
      const limited = await deps.rateLimit(request, set, new URL(request.url).pathname.endsWith('/auth/login') ? 'auth' : 'general');
      if (limited) return limited;
    })
    .onError(({ error, code, set }) => {
      const response = mobileStudentFailure(error, String(code));
      set.status = response.status;
      set.headers['Cache-Control'] = 'no-store';
      return response.body;
    })
    .post('/auth/login', async ({ body }) => {
      const auth = deps.auth();
      const account = await deps.login(body.email.trim().toLowerCase(), body.password);
      return auth.login(account);
    }, { body: t.Object({ email: t.String({ format: 'email', maxLength: 254 }), password: t.String({ minLength: 1, maxLength: 1024 }) }) })
    .post('/auth/refresh', ({ body }) => deps.auth().refresh(body.refreshToken), { body: refreshBody })
    .post('/auth/logout', async ({ body }) => {
      await deps.auth().logout(body.refreshToken);
      return { success: true };
    }, { body: refreshBody })
    .get('/me', async ({ request }) => ({ user: await deps.auth().authenticate(request.headers.get('authorization')) }))
    .get('/profile', ({ request }) => protectedRead(request, deps.profile))
    .get('/stats', ({ request }) => protectedRead(request, deps.stats))
    .get('/bookings', ({ request }) => protectedRead(request, deps.bookings));
}
