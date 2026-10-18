import assert from 'node:assert/strict';
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '15439' || url.pathname !== '/qa') throw new Error('Use an isolated QA Postgres on localhost:15439/qa.');
const { db } = await import('../src/db/postgres');
const { testingChecklistService: service } = await import('../src/services/admin.services/testingChecklist.service');
const { TESTING_RUN } = await import('../src/shared/testingChecklist');
try {
  const items = await service.list();
  assert.equal(items.length, 31);
  assert.ok(items.every(item => !item.completed));
  const initial = { completed: true, notes: 'Mobile-data synthetic test', revision: 0 };
  const results = await Promise.all([service.update('call-refresh', initial, 'tester-a'), service.update('call-refresh', initial, 'tester-b')]);
  assert.equal(results.filter(Boolean).length, 1);
  const item = (await service.list()).find(item => item.id === 'call-refresh')!;
  assert.equal(item.revision, 1); assert.equal(item.completed, true);
  assert.equal(await service.update(item.id, initial, 'stale-tester'), null);
  const reopened = await service.update(item.id, { completed: false, notes: 'Regression found', revision: item.revision }, 'tester-c');
  assert.equal(reopened?.revision, 2); assert.equal(reopened?.completed, false);
  const [audit] = await db`SELECT COUNT(*)::integer AS count FROM admin_testing_audit WHERE run_id = ${TESTING_RUN} AND item_id = ${item.id}`;
  assert.equal(audit.count, 2);
  await assert.rejects(service.update('payout-live', initial, 'tester-a'));
  assert.equal((await service.list()).find(item => item.id === 'payout-live')!.completed, false);
  console.log('Checklist persistence, concurrency, reopen, audit and gate checks passed.');
} finally { await db.close(); }
