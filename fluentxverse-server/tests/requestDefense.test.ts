import { afterEach, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { FixedWindowLimiter, MemoryRateStore, type RateStore } from '../src/utils/atomicRateLimit';
import { RequestDefense, trustedClientIP } from '../src/utils/requestDefense';
import { edgeProtected, requestPolicy } from '../../shared/requestDefense';
import { readFileSync } from 'node:fs';

const actor = async (token: string) => token === 'tutor' ? { userId: 'tutor-1', email: '', role: 'tutor' } : token === 'admin' ? { userId: 'admin-1', email: '', role: 'admin' } : null;
const allow: RateStore = { async consume() { return { allowed: true, remaining: 9999, ttl: 60000 }; } };
const make = (options: ConstructorParameters<typeof RequestDefense>[0] = {}) => {
  const gate = new RequestDefense({ limiter: () => new FixedWindowLimiter(allow, 'test'), verify: actor, trustCloudflare: true, ...options });
  return { gate, app: new Elysia().onRequest(context => gate.before(context)).onAfterResponse(({ request }) => gate.release(request)) };
};
const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) => new Request('http://localhost' + path, { method: 'POST', headers: { 'cf-connecting-ip': '1.2.3.4', ...headers }, body, duplex: 'half' } as RequestInit);
const sleep = () => Bun.sleep(0);
const previousEdge = process.env.REQUIRE_EDGE_GUARD, previousSecret = process.env.EDGE_SHARED_SECRET;
afterEach(() => { if (previousEdge === undefined) delete process.env.REQUIRE_EDGE_GUARD; else process.env.REQUIRE_EDGE_GUARD = previousEdge; if (previousSecret === undefined) delete process.env.EDGE_SHARED_SECRET; else process.env.EDGE_SHARED_SECRET = previousSecret; });

test('actual tutor, student and administrator sign-in paths have bounded authentication policies', () => {
  for (const path of ['/tutor/login', '/tutor/register', '/admin/login', '/student/login', '/student/register', '/student/auth/privy', '/student/register/privy']) {
    expect(['auth', 'privy']).toContain(requestPolicy(path, 'POST').category);
    expect(requestPolicy(path, 'POST').maxBytes).toBe(64 * 1024);
    expect(edgeProtected(path, 'POST')).toBe(true);
    expect(edgeProtected(path, 'OPTIONS')).toBe(false);
  }
});

test('both AI-generated assessment types require an authenticated tutor before generation', async () => {
  const { app } = make(); let calls = 0;
  for (const kind of ['written', 'speaking']) app.post('/exam/' + kind + '/generate', () => { calls++; return 'unexpected'; });
  for (const kind of ['written', 'speaking']) {
    const path = '/exam/' + kind + '/generate';
    expect(requestPolicy(path, 'POST').category).toBe('assessment');
    expect(edgeProtected(path, 'POST')).toBe(true);
    expect((await app.handle(post(path, '{}'))).status).toBe(401);
  }
  expect(calls).toBe(0);
});

test('bounded multipart bodies are read exactly once by manually parsed upload handlers', async () => {
  const { app } = make();
  app.post('/tutor/profile-picture', async ({ request }) => {
    const form = await request.formData();
    const file = form.get('file');
    return { label: form.get('label'), file: file instanceof File ? await file.text() : null };
  }, { parse: 'none' });
  const form = new FormData(); form.set('label', 'profile'); form.set('file', new File(['fixture'], 'sample.txt'));
  const response = await app.handle(new Request('http://localhost/tutor/profile-picture', { method: 'POST', headers: { 'cf-connecting-ip': '1.2.3.4', cookie: 'tutorAuth=tutor' }, body: form }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ label: 'profile', file: 'fixture' });
  for (const name of ['tutor', 'interview', 'lesson']) {
    const source = readFileSync(new URL('../src/routes/' + name + '.route.ts', import.meta.url), 'utf8');
    const segments = source.split(/\n  \.(?:post|put|delete|get)\(/).slice(1);
    for (const segment of segments.filter(segment => segment.includes('request.formData()'))) expect(segment).toContain("parse: 'none'");
  }
});

test('coexisting app cookies select an authorized session without accepting a token under another cookie name', async () => {
  const { app } = make();
  app.post('/tutor/profile-picture', () => 'ok', { parse: 'none' });
  expect((await app.handle(post('/tutor/profile-picture', '', { cookie: 'adminAuth=admin; tutorAuth=tutor' }))).status).toBe(200);
  await sleep();
  expect((await app.handle(post('/tutor/profile-picture', '', { cookie: 'adminAuth=admin' }))).status).toBe(403);
  expect((await app.handle(post('/tutor/profile-picture', '', { cookie: 'tutorAuth=admin' }))).status).toBe(401);
});

test('trusted identity ignores forged forwarded headers and preserves body parsing', async () => {
  const { app } = make();
  app.post('/test', ({ body, request }) => ({ body, ip: request.headers.get('x-forwarded-for') }));
  const response = await app.handle(post('/test', JSON.stringify({ ok: true }), { 'content-type': 'application/json', 'x-forwarded-for': 'attacker', 'x-real-ip': 'attacker' }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ body: { ok: true }, ip: '1.2.3.4' });
  expect(trustedClientIP(new Request('http://localhost', { headers: { 'x-forwarded-for': 'attacker' } }), true)).toBe('origin-internal');
});

test('unauthenticated and wrong-role uploads are rejected without waiting for or parsing a body', async () => {
  const { app } = make(); let reads = 0, handlerCalls = 0;
  app.post('/interview/recording', () => { handlerCalls++; return 'bad'; }, { parse: 'none' });
  const stream = () => new ReadableStream({ pull() { reads++; } }, { highWaterMark: 0 });
  expect((await app.handle(post('/interview/recording', stream()))).status).toBe(401);
  expect((await app.handle(post('/interview/recording', stream(), { cookie: 'tutorAuth=tutor' }))).status).toBe(403);
  expect(reads).toBeLessThanOrEqual(2); expect(handlerCalls).toBe(0);
});

test('chunked and falsely declared bodies are bounded before handler execution', async () => {
  const { app } = make(); let calls = 0;
  app.post('/ai/grammar-check', () => { calls++; return 'bad'; });
  const response = await app.handle(post('/ai/grammar-check', new ReadableStream({ start(c) { c.enqueue(new Uint8Array(256 * 1024 + 1)); c.close(); } }), { cookie: 'tutorAuth=tutor' }));
  expect(response.status).toBe(413); expect(calls).toBe(0);
  expect((await app.handle(post('/ai/grammar-check', '12345', { cookie: 'tutorAuth=tutor', 'content-length': '3' }))).status).toBe(400);
  expect((await app.handle(post('/ai/grammar-check', '1', { cookie: 'tutorAuth=tutor', 'content-length': 'nope' }))).status).toBe(400);
});

test('failed authentication cannot release another active proof; capacity returns after completion', async () => {
  const { app } = make(); let done: () => void = () => {}, entered: () => void = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { done = resolve; });
  app.post('/screening/admin/test/prove', async () => { entered(); await wait; return 'ok'; });
  const pending = app.handle(post('/screening/admin/test/prove', '{}', { cookie: 'adminAuth=admin' }));
  await started;
  expect((await app.handle(post('/screening/admin/test/prove', '{}'))).status).toBe(401);
  expect((await app.handle(post('/screening/admin/test/prove', '{}', { cookie: 'adminAuth=admin' }))).status).toBe(503);
  done(); expect((await pending).status).toBe(200); await sleep();
  expect((await app.handle(post('/screening/admin/test/prove', '{}', { cookie: 'adminAuth=admin' }))).status).toBe(200);
});

test('timeouts, exceptions and repeated early refusals do not leak capacity', async () => {
  const { app } = make({ bodyTimeoutMs: 15, maxActive: 1 });
  app.post('/test', () => 'ok').post('/throws', () => { throw Error('test'); });
  const slow = new ReadableStream({ pull() {} }, { highWaterMark: 0 });
  expect((await app.handle(post('/test', slow))).status).toBe(408);
  for (let index = 0; index < 4; index++) {
    expect((await app.handle(post('/test', 'ok'))).status).toBe(200); await sleep();
  }
  expect((await app.handle(post('/throws', 'ok'))).status).toBe(500); await sleep();
  expect((await app.handle(post('/test', 'ok'))).status).toBe(200);
});

test('anonymous proof intake stays anonymous; shared rate errors include CORS and Retry-After', async () => {
  let keys: string[] = [];
  const limiter = new FixedWindowLimiter({ async consume(key) { keys.push(key); return { allowed: false, remaining: 0, ttl: 12000 }; } }, 'secret');
  const { app } = make({ limiter: () => limiter });
  app.post('/anonymous-reviews/public/submit', () => 'ok');
  const response = await app.handle(post('/anonymous-reviews/public/submit', '{}', { origin: 'https://student.fluentxverse.com' }));
  expect(response.status).toBe(429); expect(response.headers.get('retry-after')).toBe('12');
  expect(response.headers.get('access-control-allow-origin')).toBe('https://student.fluentxverse.com');
  expect(keys[0]).not.toContain('1.2.3.4');
  const good = make().app.post('/anonymous-reviews/public/submit', () => 'ok');
  expect((await good.handle(post('/anonymous-reviews/public/submit', '{}'))).status).toBe(200);
});

test('Redis admission failure is closed, while private health and OPTIONS remain available', async () => {
  const { app } = make({ limiter: () => { throw Error('redis-password=private'); } });
  app.get('/health', () => 'ok').get('/anything', () => 'ok').options('/anything', () => 'ok');
  expect((await app.handle(new Request('http://localhost/health'))).status).toBe(200);
  expect((await app.handle(new Request('http://localhost/anything', { method: 'OPTIONS' }))).status).toBe(200);
  const response = await app.handle(new Request('http://localhost/anything'));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('private');
});

test('edge enforcement covers protected paths only and rejects missing or wrong edge secrets', async () => {
  process.env.REQUIRE_EDGE_GUARD = 'true'; process.env.EDGE_SHARED_SECRET = 'a'.repeat(48);
  const { app } = make(); app.post('/ai/grammar-check', () => 'ok').post('/normal', () => 'ok');
  expect((await app.handle(post('/ai/grammar-check', '{}', { cookie: 'tutorAuth=tutor' }))).status).toBe(403);
  expect((await app.handle(post('/ai/grammar-check', '{}', { cookie: 'tutorAuth=tutor', 'x-fxv-edge-token': 'wrong' }))).status).toBe(403);
  expect((await app.handle(post('/ai/grammar-check', '{}', { cookie: 'tutorAuth=tutor', 'x-fxv-edge-token': 'a'.repeat(48) }))).status).toBe(200);
  expect((await app.handle(post('/normal', '{}'))).status).toBe(200);
  expect(requestPolicy('/exam/speaking/recording', 'POST').maxBytes).toBe(9 * 1024 ** 2);
  expect(edgeProtected('/student/auth/privy', 'POST')).toBe(true);
  expect(edgeProtected('/student/refresh', 'POST')).toBe(false);
  expect(edgeProtected('/screening/admin/test/prove/', 'POST')).toBe(true);
});
