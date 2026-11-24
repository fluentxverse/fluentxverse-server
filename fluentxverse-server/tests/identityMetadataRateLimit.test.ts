import { expect, test } from 'bun:test';
import Elysia from 'elysia';
import { RequestDefense } from '../src/utils/requestDefense';
import { FixedWindowLimiter, MemoryRateStore, type RateStore } from '../src/utils/atomicRateLimit';
import { requestPolicy } from '../../shared/requestDefense';

const path = '/proof/tutor-identity/metadata/collection/invalid.json';
function fixture(options: { store?: RateStore; now?: () => number } = {}) {
  const gate = new RequestDefense({ trustCloudflare: true,
    limiter: () => new FixedWindowLimiter(options.store || store, 'test'),
    verify: async () => { throw Error('Public metadata must not parse login cookies'); },
  });
  const store = new MemoryRateStore(20000, options.now);
  let calls = 0;
  const app = new Elysia().onRequest(c => gate.before(c)).onAfterResponse(({ request }) => gate.release(request))
    .get('/proof/tutor-identity/metadata/:collection/:id', ({ set }) => { calls++; set.status = 404; return { error: 'Credential not found' }; });
  const request = async (ip = '192.0.2.1', headers: Record<string, string> = {}, suffix = 'invalid.json') => {
    const response = await app.handle(new Request('http://localhost' + path.replace('invalid.json', suffix), { headers: { 'cf-connecting-ip': ip, ...headers } }));
    await response.clone().text();
    await Bun.sleep(0); // Let Elysia finish onAfterResponse before the next read.
    return response;
  };
  return { request, calls: () => calls };
}

test('production and test metadata reads share a bounded unauthenticated policy, including HEAD', () => {
  for (const method of ['GET', 'HEAD']) for (const route of [path, path + '/', '/proof/tutor-identity/test-metadata/invalid.json']) {
    expect(requestPolicy(route, method)).toEqual({ category: 'identityMetadata', maxBytes: 0, accountLimit: 60, globalLimit: 600 });
  }
  expect(requestPolicy('/proof/tutor-certification/me', 'GET').category).toBe('general');
});

test('IP quota stops lookups, ignores rotated tokens and forwarded headers, and expires', async () => {
  let now = 1000;
  const f = fixture({ now: () => now });
  for (let n = 0; n < 60; n++) {
    expect((await f.request('192.0.2.1', { cookie: `tutorAuth=rotated-${n}`, 'x-forwarded-for': `fake-${n}` }, `${n}.json`)).status).toBe(404);
  }
  const blocked = await f.request();
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get('retry-after')).toBe('60');
  expect(blocked.headers.get('cache-control')).toBe('private, no-store');
  expect(f.calls()).toBe(60);
  expect((await f.request('192.0.2.2')).status).toBe(404);
  now += 60000;
  expect((await f.request()).status).toBe(404);
});

test('global metadata quota stops a distributed flood before handlers run', async () => {
  const f = fixture();
  for (let n = 0; n < 600; n++) {
    expect((await f.request(`192.0.2.${1 + Math.floor(n / 50)}`)).status).toBe(404);
  }
  expect((await f.request('198.51.100.1')).status).toBe(429);
  expect(f.calls()).toBe(600);
});

test('unavailable shared rate store fails closed without querying metadata', async () => {
  const f = fixture({ store: { async consume() { throw Error('offline'); } } });
  const r = await f.request();
  expect(r.status).toBe(503);
  expect(r.headers.get('retry-after')).toBe('5');
  expect(f.calls()).toBe(0);
  expect(await r.text()).not.toContain('offline');
});
