import Elysia from 'elysia';
import { timingSafeEqual } from 'node:crypto';
import { registryConfig, registryEvents, REGISTRY_POLICY } from '../services/lessonRegistry/outbox';

export const lessonRegistryRoute = new Elysia({ prefix: '/internal/lesson-registry' })
  .get('/events', async ({ request, query, set }) => {
    set.headers['Cache-Control'] = 'private, no-store';
    const expected = process.env.LESSON_REGISTRY_FEED_KEY || '', received = request.headers.get('X-FXV-Dispute-Feed-Key') || '';
    if (expected.length < 32 || received.length > 256 || Buffer.byteLength(expected) !== Buffer.byteLength(received)
      || !timingSafeEqual(Buffer.from(expected), Buffer.from(received)) || !registryConfig()) {
      set.status = 404; return { error: 'Not found' };
    }
    const after = Number(query.after || '0');
    if (!Number.isSafeInteger(after) || after < 0) { set.status = 400; return { error: 'Invalid cursor' }; }
    return { version: 2, policyHash: REGISTRY_POLICY, ...registryConfig()!, events: await registryEvents(after) };
  });
