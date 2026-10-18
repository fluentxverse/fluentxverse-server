import assert from 'node:assert/strict';
import Elysia from 'elysia';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';

// Never target application storage; this fixture uses an explicitly isolated graph.
if (process.env.COMPENSATION_TEST_URI !== 'bolt://127.0.0.1:17699') throw Error('Use the disposable compensation graph on port 17699.');
const logDatabase = new URL(process.env.DATABASE_URL || 'http://invalid');
if (logDatabase.protocol !== 'postgresql:' || logDatabase.hostname !== '127.0.0.1' || logDatabase.port !== '15439' || logDatabase.pathname !== '/qa') {
  throw Error('Use the disposable logging database at postgresql://127.0.0.1:15439/qa.');
}
process.env.JWT_SECRET = 'synthetic-compensation-test-only-secret-never-production';
const { tutorCompensationService: rates, tutorCompensationFailure } = await import('../src/services/admin.services/tutorCompensation.service');
const { adminOperationsService } = await import('../src/services/admin.services/operations.service');
const { adminOperationsRoute } = await import('../src/routes/adminOperations.route');
const { tutorEarningsRoute } = await import('../src/routes/tutorEarnings.route');
const { default: Admin } = await import('../src/routes/admin.route');
const { signAuthToken } = await import('../src/utils/jwt');
const { closePool } = await import('../src/db/postgres');
await initDriver(process.env.COMPENSATION_TEST_URI, '', '', 1);
const session = getDriver().session();
const tutorId = 'compensation-fixture';
const request = (version: number, amount: string, reason = 'Fixture adjustment') => ({ amount, currency: 'USD' as const, expectedVersion: version, requestId: crypto.randomUUID(), reason });
const app = new Elysia().onError(({ error, code, set }) => {
  const response = tutorCompensationFailure(error, code); set.status = response.status; return response.body;
}).use(Admin).use(adminOperationsRoute).use(tutorEarningsRoute);
async function call(actor: string | null, path: string, method = 'GET', body?: unknown, origin: string | null = 'https://dashboard.fluentxverse.com', role = 'admin') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (actor) headers.cookie = `adminAuth=${await signAuthToken({ userId: actor, email: 'fixture@example.test', role })}`;
  if (origin) headers.origin = origin;
  return app.handle(new Request(`http://localhost/admin/operations${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
}
try {
  assert.equal((await session.run('MATCH (n) RETURN count(n) AS total')).records[0]!.get('total').toNumber(), 0, 'Disposable graph must be empty.');
  await session.run(`CREATE (:User {id: $tutorId, givenName: 'Compensation', familyName: 'Fixture'}),
    (:User {id: 'initial-race'}), (:Student {id: 'student-fixture'}),
    (:Admin {id: 'finance-fixture', role: 'admin', permissions: ['finance'], firstName: 'Finance', lastName: 'Fixture'}),
    (:Admin {id: 'support-fixture', role: 'admin', permissions: ['support']}),
    (:Admin {id: 'second-finance', role: 'admin', permissions: ['finance']})`, { tutorId });
  const path = `/compensation/${tutorId}`;
  assert.equal((await call(null, path)).status, 403);
  assert.equal((await call('student-fixture', path, 'GET', undefined, undefined, 'student')).status, 403);
  assert.equal((await call(tutorId, path, 'GET', undefined, undefined, 'tutor')).status, 403);
  assert.equal((await call('support-fixture', path)).status, 403);
  assert.equal((await call('support-fixture', '/compensation?tutorIds=' + tutorId)).status, 403);
  assert.equal((await call('support-fixture', path, 'PUT', request(0, '12.34'))).status, 403);
  for (const origin of [null, 'https://evil.example', 'https://student.fluentxverse.com']) {
    assert.equal((await call('finance-fixture', path, 'PUT', request(0, '12.34'), origin)).status, 403);
    assert.equal((await call('finance-fixture', path, 'GET', undefined, origin)).status, 403);
    assert.equal((await call('finance-fixture', '/compensation?tutorIds=' + tutorId, 'GET', undefined, origin)).status, 403);
    assert.equal((await call('finance-fixture', path + '/earnings', 'GET', undefined, origin)).status, 403);
    assert.equal((await call('finance-fixture', path + '/payouts/fixture/evidence', 'GET', undefined, origin)).status, 403);
    assert.equal((await call('finance-fixture', path + '/earnings/fixture', 'POST', { reason: 'Fixture' }, origin)).status, 403);
  }
  assert.equal((await call('support-fixture', path + '/earnings')).status, 403);
  assert.equal((await call('finance-fixture', path + '/earnings')).status, 200);
  assert.equal((await call('finance-fixture', path + '/payouts', 'POST', { requestId: crypto.randomUUID(), bookingIds: ['fixture'], recipient: `0x${'0'.repeat(40)}`, reason: 'Fixture' })).status, 400);
  const unset = await rates.detail(tutorId);
  assert.equal(unset.compensation.baseRateCents, null); assert.equal(unset.compensation.version, 0);
  const initial = request(0, '12.34', '');
  const saved = await call('finance-fixture', path, 'PUT', initial);
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  assert.equal((await saved.json() as any).data.change.baseRateCents, 1234);
  assert.equal((await rates.save(tutorId, initial, 'finance-fixture')).replayed, true);
  assert.equal((await call('finance-fixture', path, 'PUT', request(0, '13.00'))).status, 409);
  assert.equal((await call('finance-fixture', '/compensation/missing-tutor')).status, 404);
  assert.equal((await call('finance-fixture', path, 'PUT', request(1, '13.00', ''))).status, 400);
  await assert.rejects(rates.save(tutorId, { ...initial, amount: '12.35' }, 'finance-fixture'), /already used/);
  await assert.rejects(rates.save(tutorId, initial, 'second-finance'), /already used/);
  await assert.rejects(rates.save('student-fixture', request(0, '12.34'), 'finance-fixture'), /Tutor not found/);
  await assert.rejects(rates.save(tutorId, request(1, '13.00', '  '), 'finance-fixture'), /reason is required/);
  await assert.rejects(rates.save(tutorId, request(1, '12.34'), 'finance-fixture'), /unchanged/);
  await assert.rejects(rates.save(tutorId, request(0, '13.00'), 'finance-fixture'), /changed by another/);
  const race = await Promise.allSettled([rates.save(tutorId, request(1, '13.00'), 'finance-fixture'), rates.save(tutorId, request(1, '14.00'), 'second-finance')]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  const after = await rates.detail(tutorId);
  assert.equal(after.compensation.version, 2); assert.equal(after.history.length, 2);
  assert.equal(after.history[1]!.baseRateCents, 1234); assert.equal(after.history[0]!.previousRateCents, 1234);
  const firstRace = await Promise.allSettled([rates.save('initial-race', request(0, '1.01'), 'finance-fixture'), rates.save('initial-race', request(0, '1.02'), 'second-finance')]);
  assert.equal(firstRace.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await rates.detail('initial-race')).history.length, 1);
  for (let version = 2; version < 28; version++) await rates.save(tutorId, request(version, `${version + 20}.01`), 'finance-fixture');
  const page = await rates.detail(tutorId);
  assert.equal(page.history.length, 25); assert.equal(page.nextHistoryBeforeVersion, 4);
  const earlier = await rates.detail(tutorId, page.nextHistoryBeforeVersion!);
  assert.equal(earlier.history.length, 3); assert.equal(earlier.nextHistoryBeforeVersion, null);
  assert.equal((await rates.summaries([tutorId, 'initial-race'])).length, 2);
  assert.equal((await call('finance-fixture', path)).status, 200);
  const publicRecord = (await session.run('MATCH (t:User {id: $tutorId}) RETURN t', { tutorId })).records[0]!.get('t').properties;
  assert(!('baseRateCents' in publicRecord));
  assert.equal((await adminOperationsService.audits(tutorId)).length, 0, 'Financial history must not enter unrestricted operations audits.');
  await session.run("MATCH (a:Admin {id: 'finance-fixture'}) SET a.permissions = ['support']");
  assert.equal((await call('finance-fixture', path)).status, 403);
  await assert.rejects(rates.save(tutorId, request(28, '75.00'), 'finance-fixture'), /Finance permission/);
  console.log('PASS: isolated Memgraph USD rates, atomic history, conflicts, idempotency, pagination, finance permissions, revocation and origin checks. No earnings or payouts created.');
} finally { await session.close(); await closeDriver(); await closePool().catch(() => {}); }
