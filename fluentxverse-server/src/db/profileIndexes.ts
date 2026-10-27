import type { Driver } from 'neo4j-driver';

export async function ensureProfileIndexes(driver: Pick<Driver, 'session'>) {
  const session = driver.session();
  try {
    const indexes = await session.run('SHOW INDEX INFO');
    const exists = indexes.records.some(record => record.get('label') === 'User'
      && record.get('index type') === 'label+property'
      && JSON.stringify(record.get('property')) === '["id"]');
    if (!exists) {
      try { await session.run('CREATE INDEX ON :User(id)'); }
      catch (error) {
        if (!(error instanceof Error) || !/already exists/i.test(error.message)) throw error;
      }
    }
  } finally { await session.close(); }
}
