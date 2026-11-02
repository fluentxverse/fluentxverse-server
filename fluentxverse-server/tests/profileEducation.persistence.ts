import { expect, test } from 'bun:test';
import Elysia from 'elysia';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { TutorService } from '../src/services/tutor.services/tutor.service';
import { signAuthToken } from '../src/utils/jwt';

test('education updates persist and both approved-profile fields remain pending review', async () => {
  if (process.env.EDUCATION_TEST_URI !== 'bolt://127.0.0.1:17727') throw Error('Use only the disposable education graph on port 17727');
  process.env.JWT_SECRET = 'education-fixture-not-a-production-key';
  await initDriver(process.env.EDUCATION_TEST_URI, '', '', 20, 500);
  const session = getDriver().session();
  let ownsFixture = false;
  try {
    expect((await session.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n').toNumber()).toBe(0);
    ownsFixture = true;
    await session.run("CREATE (:User {id:'education-fixture',role:'tutor',profileStatus:'incomplete',firstName:'Test'})");
    const { default: TutorRoutes } = await import('../src/routes/tutor.route');
    const api = new Elysia().use(TutorRoutes);
    const token = await signAuthToken({ userId: 'education-fixture', email: 'fixture@example.invalid', role: 'tutor' } as any);
    const patch = (data: unknown, authenticated = true) => api.handle(new Request('http://localhost/tutor/profile', { method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: `tutorAuth=${token}` } : {}) }, body: JSON.stringify(data) }));
    expect((await (await patch({ schoolAttended: 'School' }, false)).json() as any).success).toBe(false);
    for (const data of [{ schoolAttended: 5 }, { major: ' ' }, { major: 'x'.repeat(201) }]) expect((await (await patch(data)).json() as any).success).toBe(false);
    expect((await (await patch({ schoolAttended: ' Sample University ', major: ' English Education ', educationalAttainment: "Bachelor's degree", teachingExperience: '1 to 3 years', teachingQualifications: ['TEFL/TESL Certified'] })).json() as any).success).toBe(true);
    const read = async () => (await session.run("MATCH(u:User {id:'education-fixture'}) RETURN u")).records[0]!.get('u').properties;
    expect(await read()).toMatchObject({ schoolAttended: 'Sample University', major: 'English Education', profileStatus: 'incomplete' });
    expect(await read()).toMatchObject({ educationalAttainment: "Bachelor's degree", teachingExperience: '1 to 3 years', teachingQualifications: ['TEFL/TESL Certified'] });
    for (const data of [{ teachingQualifications: 'bad' }, { teachingQualifications: [5] }, { educationalAttainment: 5 }, { teachingExperience: 'x'.repeat(201) }]) expect((await (await patch(data)).json() as any).success).toBe(false);
    await session.run("MATCH(u:User {id:'education-fixture'}) SET u.profileStatus='approved'");
    expect((await (await patch({ schoolAttended: 'New University', major: 'New Degree', educationalAttainment: "Master's degree", teachingExperience: '3 to 5 years', teachingQualifications: ['Professionally trained'] })).json() as any).hasPendingChanges).toBe(true);
    let user = await read();
    expect(user.schoolAttended).toBe('Sample University');
    expect(user.major).toBe('English Education');
    expect(user.teachingExperience).toBe('1 to 3 years');
    expect(user.teachingQualifications).toEqual(['TEFL/TESL Certified']);
    expect(JSON.parse(user.pendingProfileChanges)).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemKey: 'education', fieldKey: 'schoolAttended', newValue: 'New University' }),
      expect.objectContaining({ itemKey: 'education', fieldKey: 'major', newValue: 'New Degree' }),
    ]));
    await new TutorService().updateProfile('education-fixture', { schoolAttended: 'Revised University' });
    user = await read();
    const pending = JSON.parse(user.pendingProfileChanges);
    expect(pending).toHaveLength(5);
    expect(pending.find((change: any) => change.fieldKey === 'major').newValue).toBe('New Degree');
    expect(pending.find((change: any) => change.fieldKey === 'schoolAttended').newValue).toBe('Revised University');
  } finally {
    if (ownsFixture) await session.run('MATCH(n) DETACH DELETE n');
    await session.close();
    await closeDriver();
  }
}, 20000);
