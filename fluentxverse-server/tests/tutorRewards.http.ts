import { expect, mock, test } from 'bun:test';
import Elysia from 'elysia';
let actor: any = { id: 'fixture-admin', role: 'superadmin', permissions: ['finance'] }, writes = 0, fail = false;
mock.module('../src/middleware/auth.middleware', () => ({ createAdminGuard: async () => actor ? { userId: actor.id } : null }));
mock.module('../src/services/admin.services/operations.service', () => ({ adminOperationsService: { access: async () => actor } }));
mock.module('../src/services/tutorRewards/service', () => ({ tutorRewardsService: {
  summary: async () => { if (fail) throw Error('PRIVATE_PROVIDER_CREDENTIAL'); return { deployed: true, finalized: false }; },
  preview: async () => ({ rows: [] }),
  command: async () => { writes++; return { status: 'queued' }; },
} }));
const { tutorRewardsRoute } = await import('../src/routes/tutorRewards.route');
const app = new Elysia().use(tutorRewardsRoute);
const body = { action: 'set_paused', requestId: 'c4aaf328-4563-41d2-ad94-c29a57065ab9', reason: 'Synthetic approval', params: { claimsPaused: true, allocationsPaused: true } };
const get = () => app.handle(new Request('http://localhost/admin/tutor-rewards'));
const post = (origin = 'https://dashboard.fluentxverse.com') => app.handle(new Request('http://localhost/admin/tutor-rewards/commands', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
}));
test('authentication, finance access, superadmin writes and Origin are independently enforced', async () => {
  actor = null; expect((await get()).status).toBe(403);
  const quoteUrl = 'http://localhost/admin/tutor-rewards/aero/quote?token=0x1111111111111111111111111111111111111111&amountUsd=12';
  expect((await app.handle(new Request(quoteUrl))).status).toBe(403);
  actor = { id: 'fixture', role: 'admin', permissions: ['support'] }; expect((await get()).status).toBe(403);
  actor.permissions = ['finance']; const read = await get(); expect(read.status).toBe(200); expect(read.headers.get('cache-control')).toBe('private, no-store');
  const quote = await app.handle(new Request(quoteUrl));
  expect(quote.status).toBe(409); expect(quote.headers.get('cache-control')).toBe('private, no-store');
  expect((await post()).status).toBe(403);
  actor.role = 'superadmin'; expect((await post('https://untrusted.example')).status).toBe(403);
  expect((await post('null')).status).toBe(403);
  expect(writes).toBe(0);
  const accepted = await post(); expect(accepted.status).toBe(202); expect(writes).toBe(1);
  const result = await accepted.json() as { data: { status: string } };
  expect(result.data.status).toBe('queued');
});
test('provider failures never expose private configuration or invent success', async () => {
  fail = true; const response = await get(); expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('PRIVATE_PROVIDER_CREDENTIAL');
});
