import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Elysia from 'elysia';
import { readContainerStats, validateContainerSnapshot } from '../src/services/admin.services/containerStats.service';
import { createContainerStatsRoute } from '../src/routes/containerStats.route';

const metrics = { cpuPercent: 0.15, memoryBytes: 100, memoryLimitBytes: 200, receivedBytes: 10, sentBytes: 20, blockReadBytes: 5, blockWrittenBytes: 8, pids: 3 };
const row = { id: 'a'.repeat(64), name: 'fluentxverse-server', state: 'running', status: 'Up (healthy)', metrics };
const fixture = () => ({ version: 1, sampledAt: new Date().toISOString(), hostname: 'test-cloud', containers: [structuredClone(row)] });
const directory = await mkdtemp(join(tmpdir(), 'fxv-containers-'));
afterAll(() => rm(directory, { recursive: true, force: true }));

test('reports live, partial and stale; empty and stopped sets are legitimate', () => {
  const sample = fixture();
  expect(validateContainerSnapshot(sample).status).toBe('live');
  expect(validateContainerSnapshot(sample, Date.parse(sample.sampledAt) + 31000).status).toBe('stale');
  expect(validateContainerSnapshot({ ...sample, containers: [{ ...row, metrics: null }] }).status).toBe('partial');
  expect(validateContainerSnapshot({ ...sample, containers: [{ ...row, metrics: null, state: 'exited' }] }).status).toBe('live');
  expect(validateContainerSnapshot({ ...sample, containers: [] }).snapshot.containers).toHaveLength(0);
  expect(validateContainerSnapshot({ ...sample, containers: [{ ...row, metrics: { ...metrics, cpuPercent: null } }] }).status).toBe('live');
  expect(validateContainerSnapshot({ ...sample, containers: [{ ...row, metrics: { ...metrics, cpuPercent: 250 } }] }).status).toBe('live');
});

test('rejects malformed, oversized, duplicate, secret-bearing and future snapshots', () => {
  const base = fixture();
  for (const sample of [null, {}, { ...base, env: { password: 'secret' } }, { ...base, containers: [row, row] },
    { ...base, containers: Array(257).fill(row) }, { ...base, sampledAt: 'bad' },
    { ...base, sampledAt: new Date(Date.now() + 10000).toISOString() },
    ...[{ ...row, id: '../private' }, { ...row, name: '<script>' }, { ...row, state: 'unknown' }, { ...row, command: 'private' },
      { ...row, metrics: { ...metrics, cpuPercent: -1 } }, { ...row, metrics: { ...metrics, memoryLimitBytes: 0 } },
      { ...row, metrics: { ...metrics, pids: Number.MAX_SAFE_INTEGER + 1 } }].map(row => ({ ...base, containers: [row] })),
  ]) expect(() => validateContainerSnapshot(sample)).toThrow('Container monitoring is unavailable.');
});

test('file reads are bounded and errors contain no private paths', async () => {
  const path = join(directory, 'snapshot.json');
  await writeFile(path, JSON.stringify(fixture()));
  expect((await readContainerStats(path)).status).toBe('live');
  for (const content of ['bad JSON', 'x'.repeat(262145)]) {
    await writeFile(path, content);
    await expect(readContainerStats(path)).rejects.toThrow('Container monitoring is unavailable.');
  }
  await expect(readContainerStats(join(directory, 'private-path'))).rejects.toThrow(/^Container monitoring is unavailable\.$/);
});

test('operations permission precedes file reads; no-cache survives parent hooks and other routes are unaffected', async () => {
  let reads = 0;
  const app = new Elysia().onRequest(({ set }) => { set.headers['cache-control'] = 'no-store'; })
    .use(createContainerStatsRoute(async () => { reads++; return validateContainerSnapshot(fixture()); }, async (cookie, set, capability) => {
      expect(capability).toBe('operations');
      if (!cookie.adminAuth?.value) { set.status = 401; return null; }
      if (cookie.adminAuth.value !== 'ops') { set.status = 403; return null; }
      return { userId: 'ops', email: '', role: 'admin' };
    })).get('/unrelated', () => 'ok');
  for (const [cookie, status] of [['', 401], ['adminAuth=support', 403], ['adminAuth=student', 403], ['adminAuth=ops', 200]] as const) {
    const response = await app.handle(new Request('http://localhost/admin/container-stats', { headers: { cookie } }));
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    if (status !== 200) expect((await response.json()).data).toBeUndefined();
  }
  expect(reads).toBe(1);
  expect((await app.handle(new Request('http://localhost/unrelated'))).status).toBe(200);
});

test('collector failure returns sanitized 503 and endpoint is read-only', async () => {
  const app = new Elysia().use(createContainerStatsRoute(async () => { throw new Error('password=private /host/path'); }, async () => ({ userId: 'ops', email: '' })));
  const response = await app.handle(new Request('http://localhost/admin/container-stats'));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ success: false, error: 'Container monitoring is unavailable.' });
  expect((await app.handle(new Request('http://localhost/admin/container-stats', { method: 'POST' }))).status).toBe(404);
});
