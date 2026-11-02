import { expect, test } from 'bun:test';
import Elysia from 'elysia';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { signAuthToken } from '../src/utils/jwt';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('API rejects invalid interests and photos without changing existing profile media', async () => {
  if (process.env.PROFILE_GUIDELINES_TEST_URI !== 'bolt://127.0.0.1:17728') throw new Error('Use only the disposable graph on 17728');
  process.env.JWT_SECRET = 'guidelines-fixture-not-a-production-key';
  await initDriver(process.env.PROFILE_GUIDELINES_TEST_URI, '', '', 30, 500);
  const session = getDriver().session();
  let ownsFixture = false;
  const directory = await mkdtemp(join(tmpdir(), 'fxv-guidelines-test-'));
  try {
    expect((await session.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n').toNumber()).toBe(0);
    ownsFixture = true;
    await session.run("CREATE (:User {id:'guidelines-fixture',role:'tutor',profileStatus:'incomplete',profilePicture:'existing.jpg',interests:'[\"Reading\"]'})");
    const { default: Tutor } = await import('../src/routes/tutor.route');
    const api = new Elysia().use(Tutor);
    const token = await signAuthToken({ userId: 'guidelines-fixture', role: 'tutor', email: 'fixture@example.invalid' } as any);
    const headers = { Cookie: `tutorAuth=${token}` };
    for (const interests of [['a','b','c','d','e','f'], ['Reading','reading'], [''], [5], ['x'.repeat(31)]]) {
      const response = await api.handle(new Request('http://localhost/tutor/profile', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ interests }) }));
      expect((await response.json() as any).success).toBe(false);
    }
    const small = join(directory, 'small.jpg');
    execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=gray:s=200x200','-frames:v','1','-f','image2','-update','1',small]);
    for (const file of [new File(['PNG'], 'photo.png', { type: 'image/png' }), new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' }), new File([await readFile(small)], 'small.jpg', { type: 'image/jpeg' }), new File(['not JPEG'], 'fake.jpg', { type: 'image/jpeg' })]) {
      const form = new FormData(); form.set('file', file);
      const response = await api.handle(new Request('http://localhost/tutor/profile-picture', { method: 'POST', headers, body: form }));
      expect((await response.json() as any).success).toBe(false);
    }
    const profile = (await session.run("MATCH(u:User {id:'guidelines-fixture'}) RETURN u")).records[0]!.get('u').properties;
    expect(profile.profilePicture).toBe('existing.jpg');
    expect(JSON.parse(profile.interests)).toEqual(['Reading']);
  } finally {
    if (ownsFixture) await session.run('MATCH(n) DETACH DELETE n');
    await session.close(); await closeDriver(); await rm(directory, { recursive: true, force: true });
  }
}, 20000);
