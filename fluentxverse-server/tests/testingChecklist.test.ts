import { expect, test } from 'bun:test';
import { testingChecklist, validateTestingUpdate } from '../src/shared/testingChecklist';
import { createTestingChecklistRoute } from '../src/routes/testingChecklist.route';

test('pilot catalog has stable unique IDs, acceptance criteria and honest release gates', () => {
  expect(new Set(testingChecklist.map(item => item.id)).size).toBe(testingChecklist.length);
  expect(testingChecklist.length).toBe(31);
  for (const item of testingChecklist) {
    expect(item.id).toMatch(/^[a-z-]+$/);
    expect(item.steps.length).toBeGreaterThan(20);
    expect(item.expected.length).toBeGreaterThan(20);
  }
  expect(testingChecklist.filter(item => item.gate).map(item => item.id)).toEqual(['screening-live', 'payout-live']);
});

test('updates reject unknown IDs, invalid revisions and gated passes', () => {
  const value = { completed: true, notes: '  Tested on mobile  ', revision: 0 };
  expect(validateTestingUpdate('call-refresh', value).notes).toBe('Tested on mobile');
  for (const patch of [{ revision: -1 }, { revision: .5 }, { notes: 'a'.repeat(2001) }, { completed: 'yes' }]) expect(() => validateTestingUpdate('call-refresh', { ...value, ...patch } as any)).toThrow();
  expect(() => validateTestingUpdate('unknown', value)).toThrow();
  expect(() => validateTestingUpdate('payout-live', value)).toThrow();
  expect(validateTestingUpdate('payout-live', { ...value, completed: false }).completed).toBe(false);
});

test('HTTP checklist requires auth, operations writes, trusted origin and exact body', async () => {
  let mutations = 0;
  const service: any = { list: async () => [], update: async (id: string, input: any) => { mutations++; return { id, ...input }; } };
  const guard: any = async (cookie: any, set: any, capability?: string) => {
    const role = cookie.adminAuth?.value;
    if (!role) { set.status = 401; return null; }
    if (capability && role !== 'operator') { set.status = 403; return null; }
    return { userId: 'test-admin', email: 'test@example.invalid' };
  };
  const app = createTestingChecklistRoute(service, guard);
  const request = (method: string, path = '/', role = 'operator', body?: any, origin = 'https://dashboard.fluentxverse.com') => app.handle(new Request(`http://localhost/admin/testing${path}`, {
    method, headers: { ...(role ? { cookie: `adminAuth=${role}` } : {}), origin, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }));
  expect((await request('GET', '/', '')).status).toBe(401);
  const read = await request('GET', '/', 'reader');
  expect(read.status).toBe(200);
  expect(read.headers.get('cache-control')).toContain('no-store');
  expect((await read.json() as any).data.canEdit).toBe(false);
  const body = { completed: true, notes: '', revision: 0 };
  expect((await request('PATCH', '/call-refresh', 'reader', body)).status).toBe(403);
  expect((await request('PATCH', '/call-refresh', 'operator', body, 'https://evil.invalid')).status).toBe(403);
  expect((await request('PATCH', '/call-refresh', 'operator', body, '')).status).toBe(403);
  expect((await request('PATCH', '/missing', 'operator', body)).status).toBe(404);
  expect((await request('PATCH', '/payout-live', 'operator', body)).status).toBe(409);
  expect((await request('PATCH', '/call-refresh', 'operator', { ...body, enabled: true })).status).toBe(400);
  expect((await request('PATCH', '/call-refresh', 'operator', { ...body, completed: 'true' })).status).toBe(400);
  expect(mutations).toBe(0);
  expect((await request('PATCH', '/call-refresh', 'operator', body)).status).toBe(200);
  expect(mutations).toBe(1);
  service.update = async () => null;
  expect((await request('PATCH', '/call-refresh', 'operator', body)).status).toBe(409);
});
