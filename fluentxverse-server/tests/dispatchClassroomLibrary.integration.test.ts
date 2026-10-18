import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { initDriver, closeDriver, getDriver } from '../src/db/memgraph';
import { dispatchService } from '../src/services/dispatch.services/dispatch.service';

const uri = process.env.DISPATCH_LIBRARY_TEST_URI;
const suite = uri ? describe : describe.skip;
const fixtureId = `dispatch-library-test-${crypto.randomUUID()}`;

suite('published classroom article metadata', () => {
  beforeAll(async () => {
    await initDriver(uri!, process.env.MEMGRAPH_USER || 'fluentxverse', process.env.MEMGRAPH_PASSWORD || '', 1);
    const session = getDriver().session();
    try {
      await session.run(`UNWIND ['published', 'draft'] AS status
        CREATE (:DispatchArticle {id: $fixtureId + '-' + status, title: 'Test article', topic: 'News', category: 'Science',
          postedDate: '2026-10-05', createdAt: '2026-09-01T00:00:00Z', status: status, dispatchLibraryTestId: $fixtureId,
          articleContent: 'Full article text must not be returned'})`, { fixtureId });
      await session.run(`CREATE (:DispatchArticle {id: $fixtureId + '-legacy', title: 'Legacy article',
        topic: 'News', category: 'Science', postedDate: 'January 15, 2026',
        createdAt: '2026-01-17T08:11:32.012Z', dispatchLibraryTestId: $fixtureId})`, { fixtureId });
    } finally { await session.close(); }
  });
  afterAll(async () => {
    const session = getDriver().session();
    try {
      await session.run('MATCH (article:DispatchArticle {dispatchLibraryTestId: $fixtureId}) DETACH DELETE article', { fixtureId });
    } finally { await session.close(); await closeDriver(); }
  });
  test('returns published metadata and preserves the actual post date without article bodies', async () => {
    const result = await dispatchService.classroomLibrary();
    expect(result.find(article => article.id === `${fixtureId}-published`)).toMatchObject({ postedDate: '2026-10-05', createdAt: '2026-09-01T00:00:00Z', status: 'published' });
    expect(result.some(article => article.id === `${fixtureId}-draft`)).toBe(false);
    expect(result.find(article => article.id === `${fixtureId}-published`)).not.toHaveProperty('articleContent');
  });
  test('includes live legacy articles without a status and normalizes their publication metadata', async () => {
    const result = await dispatchService.classroomLibrary();
    expect(result.find(article => article.id === `${fixtureId}-legacy`)).toMatchObject({
      postedDate: 'January 15, 2026', status: 'published',
    });
    expect(result.some(article => article.id === `${fixtureId}-draft`)).toBe(false);
  });
});
