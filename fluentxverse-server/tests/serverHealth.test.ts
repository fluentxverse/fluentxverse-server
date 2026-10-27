import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Elysia from 'elysia';
import { readServerHealth, validateHostSnapshot } from '../src/services/admin.services/serverHealth.service';
import { createServerHealthRoute } from '../src/routes/serverHealth.route';

const fixture = () => ({
  version: 1, sampledAt: new Date().toISOString(), hostname: 'test-cloud', uptimeSeconds: 120,
  cpu: { model: 'AMD EPYC', cores: 1, usagePercent: 12 },
  memory: { totalBytes: 8192, usedBytes: 2048, availableBytes: 6144 },
  disk: { totalBytes: 80000, usedBytes: 20000, availableBytes: 55000 },
  network: { interface: 'ens3', addresses: ['185.184.223.23/24'], receivedBytes: 100, sentBytes: 200, receiveBytesPerSecond: 2, sendBytesPerSecond: 4 },
  bandwidth: { allowanceBytes: 2048 * 1024 ** 3, billingSource: 'not_connected' },
});
const directory = await mkdtemp(join(tmpdir(), 'fxv-metrics-'));
afterAll(() => rm(directory, { recursive: true, force: true }));

test('freshness is explicit; first sample null rates are valid', () => {
  const data = fixture();
  expect(validateHostSnapshot(data).status).toBe('live');
  expect(validateHostSnapshot(data, Date.parse(data.sampledAt) + 31000).status).toBe('stale');
  expect(validateHostSnapshot(data, Date.parse(data.sampledAt) + 30000).status).toBe('live');
  const first = { ...data, cpu: { ...data.cpu, usagePercent: null }, network: { ...data.network, receiveBytesPerSecond: null, sendBytesPerSecond: null } };
  expect(validateHostSnapshot(first).snapshot.cpu.usagePercent).toBeNull();
});

test('invalid, inconsistent, future and secret-bearing snapshots fail closed', () => {
  const base = fixture();
  for (const value of [null, {}, { ...base, token: 'private' }, { ...base, version: 2 },
    { ...base, cpu: { ...base.cpu, usagePercent: 101 } }, { ...base, cpu: { ...base.cpu, cores: 0 } },
    { ...base, network: { ...base.network, receiveBytesPerSecond: -1 } },
    { ...base, network: { ...base.network, sentBytes: Number.MAX_SAFE_INTEGER + 1 } },
    { ...base, memory: { totalBytes: 100, usedBytes: 90, availableBytes: 11 } },
    { ...base, disk: { totalBytes: 100, usedBytes: 101, availableBytes: 0 } },
    { ...base, sampledAt: 'invalid' }, { ...base, sampledAt: new Date(Date.now() + 10000).toISOString() },
    { ...base, bandwidth: { ...base.bandwidth, billingSource: 'fabricated' } },
  ]) expect(() => validateHostSnapshot(value)).toThrow('Host monitoring is unavailable.');
});

test('file reader bounds size and sanitizes missing, malformed and private paths', async () => {
  const path = join(directory, 'snapshot.json');
  await writeFile(path, JSON.stringify(fixture()));
  expect((await readServerHealth(path)).status).toBe('live');
  for (const content of ['{broken', 'x'.repeat(65537)]) {
    await writeFile(path, content);
    await expect(readServerHealth(path)).rejects.toThrow('Host monitoring is unavailable.');
  }
  await expect(readServerHealth(join(directory, 'secret-name'))).rejects.toThrow(/^Host monitoring is unavailable\.$/);
  await expect(readServerHealth(directory)).rejects.toThrow('Host monitoring is unavailable.');
});

test('HTTP requires operations permission before reading host data and does not cache', async () => {
  let calls = 0;
  const read = async () => { calls++; return validateHostSnapshot(fixture()); };
  const app = new Elysia().onRequest(({ set }) => { set.headers['cache-control'] = 'no-store'; }).use(createServerHealthRoute(read, async (cookie, set, capability) => {
    expect(capability).toBe('operations');
    if (!cookie.adminAuth?.value) { set.status = 401; return null; }
    if (cookie.adminAuth.value !== 'ops') { set.status = 403; return null; }
    return { userId: 'test-admin', role: 'admin' } as any;
  })).get('/unrelated', () => 'ok');
  for (const [cookie, status] of [['', 401], ['adminAuth=student', 403], ['adminAuth=support', 403], ['adminAuth=ops', 200]] as const) {
    const response = await app.handle(new Request('http://localhost/admin/server-health', { headers: { cookie } }));
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  }
  expect(calls).toBe(1);
  expect((await app.handle(new Request('http://localhost/unrelated'))).status).toBe(200);
});

test('HTTP collector failure is a sanitized 503, not an auth failure', async () => {
  const app = new Elysia().use(createServerHealthRoute(async () => { throw new Error('/private/path password=secret'); }, async () => ({ userId: 'ops' } as any)));
  const response = await app.handle(new Request('http://localhost/admin/server-health'));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ success: false, error: 'Host monitoring is unavailable.' });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
