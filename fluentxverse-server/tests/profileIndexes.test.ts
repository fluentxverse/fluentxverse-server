import { expect, test } from 'bun:test';
import { ensureProfileIndexes } from '../src/db/profileIndexes';

function driver(existing: boolean, fail = false) {
  const queries: string[] = []; let closed = false;
  return {
    queries, get closed() { return closed; },
    session() { return { async run(query: string) {
      queries.push(query);
      if (fail) throw new Error('Database unavailable');
      return { records: existing ? [{ get: (key: string) => ({ label: 'User', 'index type': 'label+property', property: ['id'] } as Record<string, unknown>)[key] }] : [] };
    }, async close() { closed = true; } }; },
  };
}
test('profile startup adds the missing lookup index', async () => {
  const db = driver(false);
  await ensureProfileIndexes(db as any);
  expect(db.queries).toEqual(['SHOW INDEX INFO', 'CREATE INDEX ON :User(id)']);
  expect(db.closed).toBe(true);
});
test('an existing profile index is left intact', async () => {
  const db = driver(true);
  await ensureProfileIndexes(db as any);
  expect(db.queries).toEqual(['SHOW INDEX INFO']);
  expect(db.closed).toBe(true);
});
test('index initialization closes its session even when the database fails', async () => {
  const db = driver(false, true);
  await expect(ensureProfileIndexes(db as any)).rejects.toThrow('Database unavailable');
  expect(db.closed).toBe(true);
});
