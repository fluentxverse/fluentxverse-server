import { getDriver } from '../../db/memgraph';
export async function ensureTutorIdentitySchema() {
  const s = getDriver().session();
  const create = async (query: string) => {
    try { await s.run(query); }
    catch (error) { if (!(error instanceof Error) || !/already exists/i.test(error.message)) throw error; }
  };
  try {
    for (const label of ['TutorIdentity', 'TutorIdentityNotice', 'TutorIdentityCredential']) {
      await create(`CREATE CONSTRAINT ON (n:${label}) ASSERT n.id IS UNIQUE`);
      await create(`CREATE INDEX ON :${label}(id)`);
    }
    await create('CREATE INDEX ON :TutorIdentity(deleteAt)');
    await create('CREATE INDEX ON :TutorIdentity(status)');
    await create('CREATE INDEX ON :TutorIdentityNotice(nextAttempt)');
  } finally { await s.close(); }
}
