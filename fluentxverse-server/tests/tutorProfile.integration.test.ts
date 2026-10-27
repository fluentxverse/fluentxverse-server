import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import Tutor from '../src/routes/tutor.route';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { ensureProfileIndexes } from '../src/db/profileIndexes';
import { TutorService } from '../src/services/tutor.services/tutor.service';
import { tutorProfileQuery } from '../src/services/tutor.services/tutorProfileQuery';
import { signAuthToken } from '../src/utils/jwt';

const uri = process.env.TUTOR_PROFILE_TEST_URI;
const isolated = uri && new URL(uri).hostname === '127.0.0.1' && new URL(uri).port === '17692';
const suite = isolated ? describe : describe.skip;
const id = `profile-test-${crypto.randomUUID()}`;
const graph = async (query: string, params: Record<string, any> = {}) => {
  const session = getDriver().session();
  try { return await session.run(query, params); } finally { await session.close(); }
};
suite('profile optimization (disposable Memgraph only)', () => {
  beforeAll(async () => {
    await initDriver(uri!, '', '', 3, 500);
    await graph(`CREATE (u:User {id:$id, firstName:'Test', lastName:'Tutor', email:'test@example.test', schoolAttended:'Example University', major:'English',
      languages:'["English"]', education:'[]', interests:'["Reading"]', rating:'5.0', totalReviews:'1',
      passwordHash:'PRIVATE', screeningAnswers:$answers, addressLine:'PRIVATE', profileStatus:'approved'})
      CREATE (u)-[:HAS_CERTIFICATION_CREDENTIAL]->(:TutorCertificationCredential {status:'verified', credentialCommitment:'public-commitment', privateWitness:'PRIVATE'})`, { id, answers: 'PRIVATE'.repeat(10000) });
    await ensureProfileIndexes(getDriver());
  });
  afterAll(async () => {
    await graph('MATCH (u:User {id:$id}) OPTIONAL MATCH (u)-[:HAS_CERTIFICATION_CREDENTIAL]->(c) DETACH DELETE u,c', { id });
    await closeDriver();
  });
  test('lookup uses the property index and startup is idempotent', async () => {
    await ensureProfileIndexes(getDriver());
    const plan = await graph('EXPLAIN ' + tutorProfileQuery, { tutorId: id });
    const text = plan.records.map(row => row.get('QUERY PLAN')).join('\n');
    expect(text).toMatch(/ScanAllByLabelPropert/);
    expect(text).not.toContain('ScanAll (u)');
  });
  test('projection retains education, rating and proof summary but excludes unrelated account fields', async () => {
    const raw = await graph(tutorProfileQuery, { tutorId: id });
    expect(JSON.stringify(raw.records.map(row => row.toObject()))).not.toContain('PRIVATE');
    const profile = await new TutorService().getTutorProfile(id);
    expect(profile?.schoolAttended).toBe('Example University');
    expect(profile?.major).toBe('English');
    expect(profile?.rating).toBe(5);
    expect(profile?.interests).toEqual(['Reading']);
    expect(profile?.zkCertificationStatus).toBe('retired');
    expect(profile?.zkVerifiedAt).toBeUndefined();
    expect(profile?.zkCredentialCommitment).toBe('public-commitment');
    expect(await new TutorService().getTutorProfile('missing-profile-fixture')).toBeNull();
  });
  test('own-profile request scope remains authenticated and private', async () => {
    const app = new Elysia().use(Tutor);
    const token = await signAuthToken({ userId: id, email: 'test@example.test', role: 'tutor' });
    const response = await app.handle(new Request('http://localhost/tutor/profile?tutorId=other', { headers: { cookie: `tutorAuth=${token}` } }));
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Server-Timing')).toMatch(/^profile;dur=/);
    expect((await response.json() as any).data.userId).toBe(id);
    const unauthenticated = await app.handle(new Request('http://localhost/tutor/profile'));
    expect((await unauthenticated.json() as any).success).toBe(false);
  });
});
