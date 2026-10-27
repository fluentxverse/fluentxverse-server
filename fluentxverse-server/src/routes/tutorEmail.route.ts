import Elysia, { t } from 'elysia';
import { isAllowedTutorMutationOrigin } from '../config/cors';
import { resolveTutorSession } from '../utils/tutorSession';
import { tutorEmailService, type TutorEmailService } from '../services/auth.services/tutorEmail.service';
import { TutorEmailError, tutorEmailFailure } from '../services/auth.services/tutorEmailPolicy';

export function createTutorEmailRoutes(service: TutorEmailService = tutorEmailService) {
  const actor = async (request: Request) => {
    const session = await resolveTutorSession(request);
    if (!session) throw new TutorEmailError(401, 'Sign in to your tutor account to confirm your email.');
    return session.userId;
  };
  return new Elysia({ name: 'tutor-email-confirmation', prefix: '/email-verification', normalize: false })
    .onBeforeHandle(({ request, set }) => {
      set.headers['Cache-Control'] = 'private, no-store';
      if (request.method !== 'GET' && !isAllowedTutorMutationOrigin(request.headers.get('origin')))
        throw new TutorEmailError(403, 'Tutor application origin required.');
    })
    .onError(({ error, code, set }) => {
      const failure = tutorEmailFailure(error, code);
      set.status = failure.status;
      set.headers['Cache-Control'] = 'private, no-store';
      if (failure.retryAfter) set.headers['Retry-After'] = String(failure.retryAfter);
      return failure.body;
    })
    .get('/', async ({ request }) => ({ success: true, data: await service.status(await actor(request)) }))
    .post('/send', async ({ request }) => ({ success: true, data: await service.send(await actor(request)) }))
    .post('/confirm', async ({ request, body }) => ({ success: true, data: await service.confirm(body.token, (await resolveTutorSession(request))?.userId) }),
      { body: t.Object({ token: t.String({ minLength: 43, maxLength: 43, pattern: '^[a-zA-Z0-9_-]+$' }) }, { additionalProperties: false }) });
}
