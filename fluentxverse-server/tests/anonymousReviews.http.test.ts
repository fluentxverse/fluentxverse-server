import { afterEach, expect, spyOn, test } from 'bun:test';
import Elysia from 'elysia';
import { createAnonymousReviewRoutes } from '../src/routes/anonymousReviews.route';
import { AnonymousReviewService } from '../src/services/anonymousReviews/service';

const previous = process.env.ANONYMOUS_REVIEWS_ENABLED;
afterEach(() => { if (previous === undefined) delete process.env.ANONYMOUS_REVIEWS_ENABLED; else process.env.ANONYMOUS_REVIEWS_ENABLED = previous; });
const service = new AnonymousReviewService(), app = new Elysia().use(createAnonymousReviewRoutes(service));
const body = { groupId: `0x${'b'.repeat(64)}`, content: { rating: 5, positive: ['feedback'], improvement: [], salt: 'ab'.repeat(32) },
  proof: { merkleTreeDepth: 8, merkleTreeRoot: '1', nullifier: '2', message: '3', scope: '4', points: Array(8).fill('0') } };
const post = (path: string, data: unknown, headers: Record<string, string> = {}) => app.handle(new Request(`http://localhost/anonymous-reviews/${path}`,
  { method: 'POST', headers: { origin: 'https://student.fluentxverse.com', 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) }));
test('pilot fails closed and enrollment/operator actions require authentication', async () => {
  process.env.ANONYMOUS_REVIEWS_ENABLED = 'false'; expect((await post('public/submit', body)).status).toBe(503);
  process.env.ANONYMOUS_REVIEWS_ENABLED = 'true';
  expect((await post('enroll/booking', { commitment: '123' })).status).toBe(401);
  expect((await post(`admin/group/${body.groupId}/activate`, {}, { origin: 'https://untrusted.test' })).status).toBe(403);
  expect((await post(`admin/group/${body.groupId}/activate`, {}, { origin: 'https://dashboard.fluentxverse.com' })).status).toBe(401);
  for (const phase of ['prepare', 'prove', 'submit', 'certify']) {
    const data = phase === 'certify' ? { aggregationId: '1', merklePath: [], leafCount: '1', index: '0' } : {};
    expect((await post(`admin/group/${body.groupId}/tally/${phase}`, data, { origin: 'https://dashboard.fluentxverse.com' })).status).toBe(401);
  }
});
test('anonymous proof intake rejects cookie/bearer requests and never accepts identifiers or comments', async () => {
  process.env.ANONYMOUS_REVIEWS_ENABLED = 'true'; const receive = spyOn(service, 'receive').mockResolvedValue({ id: body.groupId, status: 'queued', verified: false });
  try {
    for (const headers of [{ cookie: 'studentAuth=secret' }, { authorization: 'Bearer secret' }] as Record<string, string>[]) expect((await post('public/submit', body, headers)).status).toBe(400);
    expect((await post('public/submit', body, { origin: 'https://untrusted.test' })).status).toBe(403);
    const response = await post('public/submit', body); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(receive).toHaveBeenCalledTimes(1);
    const extra = await post('public/submit', { ...body, studentId: 'private-student' }); expect(extra.status).not.toBe(200);
    const comment = await post('public/submit', { ...body, content: { ...body.content, comment: 'My name is...' } }); expect(comment.status).not.toBe(200);
  } finally { receive.mockRestore(); }
});
test('body limits apply even when Content-Length is omitted', async () => {
  process.env.ANONYMOUS_REVIEWS_ENABLED = 'true';
  const response = await post('public/submit', { ...body, unexpected: 'x'.repeat(20_000) });
  expect(response.status).toBe(413);
});
test('review body limits do not reject unrelated application uploads', async () => {
  const parent = new Elysia().use(createAnonymousReviewRoutes(service))
    .post('/exam/speaking/recording', ({ body }) => ({ length: (body as any).audio.length }));
  const response = await parent.handle(new Request('http://localhost/exam/speaking/recording', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: 'x'.repeat(400_000) }),
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ length: 400_000 });
});
