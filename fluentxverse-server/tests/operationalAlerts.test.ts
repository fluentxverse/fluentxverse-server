import { test, expect } from 'bun:test';
import { createOperationalAlertsRoute } from '../src/routes/operationalAlerts.route';
import { collectAlertTelemetry, monitorAuthorized } from '../src/services/admin.services/operationalAlerts.service';

test('monitor secrets are required, compared exactly and never accepted from user cookies', () => {
  const secret = 'a'.repeat(64);
  expect(monitorAuthorized(null, secret)).toBe(false); expect(monitorAuthorized(secret, secret)).toBe(true);
  expect(monitorAuthorized(secret + 'x', secret)).toBe(false); expect(monitorAuthorized('', '')).toBe(false);
});
test('telemetry sanitizes data, preserves failures as unknown and never fabricates zero errors', async () => {
  const telemetry = await collectAlertTelemetry({
    host: async () => { throw Error('down'); }, containers: async () => ({ status: 'live', ageSeconds: 0, snapshot: { version: 1, hostname: 'host', sampledAt: new Date().toISOString(), containers: [
      { id: 'a'.repeat(64), name: 'fluentxverse-server', state: 'running', status: 'Up', metrics: null, restartCount: 4, health: 'healthy' },
      { id: 'b'.repeat(64), name: 'unrelated-tenant', state: 'running', status: 'Up', metrics: null },
    ] } }), recordings: async () => { throw Error('private DB error'); }, proofs: async () => ({ pending: 2, oldestAt: null, missingTimestamp: 2 }),
  });
  expect(telemetry.host).toBeNull(); expect(telemetry.recordings).toBeNull(); expect(telemetry.containers).toHaveLength(1);
  expect(telemetry.containers![0]!.restartCount).toBe(4); expect(JSON.stringify(telemetry)).not.toContain('private DB error');
});
test('alert routes enforce operations access, private caching, telemetry secret and trusted acknowledgement actor', async () => {
  let role = 'none', calls = 0, actor = '';
  const app = createOperationalAlertsRoute({
    guard: async (_c, set, capability) => { expect(capability).toBe('operations'); if (role !== 'ops') { set.status = role === 'none' ? 401 : 403; return null; } return { userId: 'actual-admin', role: 'admin' } as any; },
    authorized: key => key === 'monitor-secret', collect: async () => { calls++; return {} as any; },
    monitor: async (_path, body) => { calls++; actor = body?.actor || ''; return { version: 1, incidents: [] } as any; },
  });
  const get = (path: string, init?: RequestInit) => app.handle(new Request('http://localhost' + path, init));
  for (const [user, expected] of [['none',401],['support',403],['ops',200]] as const) { role = user; const r = await get('/admin/alerts'); expect(r.status).toBe(expected); expect(r.headers.get('cache-control')).toBe('private, no-store'); }
  const before = calls;
  expect((await get('/internal/operational-alerts/telemetry')).status).toBe(401); expect(calls).toBe(before);
  expect((await get('/internal/operational-alerts/telemetry', { headers: { 'x-fxv-monitor-key': 'monitor-secret' } })).status).toBe(200);
  const path = '/admin/alerts/11111111-1111-4111-8111-111111111111/acknowledge';
  expect((await get(path, { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403);
  expect((await get(path, { method: 'POST', headers: { origin: 'https://dashboard.fluentxverse.com' } })).status).toBe(200);
  expect(actor).toBe('actual-admin');
});
