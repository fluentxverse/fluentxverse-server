import { expect, mock, test } from 'bun:test';
import Elysia from 'elysia';
let actor: any = null, confirmed: any;
mock.module('../src/middleware/auth.middleware', () => ({ createTutorGuard: async () => actor }));
mock.module('../src/services/tutorRewards/claims', () => ({ tutorRewardClaims: {
  summary: async (id: string) => ({ owner: id }), quote: async (id: string) => ({ owner: id }),
  confirm: async (...args: any[]) => { confirmed = args; return { status: 'queued' }; },
} }));
const { tutorRewardClaimsRoute } = await import('../src/routes/tutorRewardClaims.route');
const app = new Elysia().use(tutorRewardClaimsRoute);
const get = () => app.handle(new Request('http://localhost/tutor/rewards'));
const post = (origin: string, body: any) => app.handle(new Request('http://localhost/tutor/rewards/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) }));
test('only authenticated tutors on trusted origins can confirm an immutable saved quote', async () => {
  expect((await get()).status).toBe(401); actor = { role: 'student', userId: 'other' }; expect((await get()).status).toBe(401);
  actor = { role: 'tutor', userId: 'logged-in-tutor' };
  const r = await get(); expect(r.status).toBe(200); expect(r.headers.get('cache-control')).toBe('private, no-store');
  const quoteId = crypto.randomUUID(); expect((await post('https://evil.example', { quoteId })).status).toBe(403);
  expect((await post('https://tutor.fluentxverse.com', { quoteId, wallet: 'injected' })).status).toBe(202);
  expect(confirmed).toEqual(['logged-in-tutor', quoteId]);
  expect((await post('https://tutor.fluentxverse.com', { quoteId })).status).toBe(202);
  expect(confirmed).toEqual(['logged-in-tutor', quoteId]);
});
