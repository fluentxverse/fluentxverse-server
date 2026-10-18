import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { AdminService } from '../src/services/admin.services/admin.service';
import { adminOperationsRoute } from '../src/routes/adminOperations.route';
import { assertTutorCanSchedule } from '../src/services/schedule.services/schedulingGuards';
import { reconcileTutorPenaltyBlock } from '../src/services/schedule.services/tutorPenaltyBlock';
import { signAuthToken } from '../src/utils/jwt';

const suite = process.env.ADMIN_TUTOR_TEST_URI ? describe : describe.skip;
const prefix = `admin-tutors-${crypto.randomUUID()}`;
const id = (suffix: string) => `${prefix}-${suffix}`;
const graph = async (text: string, params: Record<string, any> = {}) => {
  const session = getDriver().session(); try { return await session.run(text, params); } finally { await session.close(); }
};
const app = new Elysia().use(adminOperationsRoute);
let operator = '', support = '';
const request = (cookie: string, reason = 'Account reviewed and temporary block lifted.', origin = 'http://localhost:5175') => app.handle(new Request(`http://localhost/admin/operations/tutors/${id('blocked')}/unblock`, {
  method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ reason }),
}));

suite('tutor management photo and booking access (disposable Memgraph only)', () => {
  beforeAll(async () => {
    await initDriver(process.env.ADMIN_TUTOR_TEST_URI!, '', '', 3, 500);
    for (const [suffix, permissions] of [['operator', ['operations']], ['support', ['support']]] as const) {
      await graph('CREATE (:Admin {id:$id, role:"admin", permissions:$permissions})', { id: id(suffix), permissions: [...permissions] });
    }
    operator = `adminAuth=${await signAuthToken({ userId: id('operator'), email: 'operator@example.test', role: 'admin' })}`;
    support = `adminAuth=${await signAuthToken({ userId: id('support'), email: 'support@example.test', role: 'superadmin' })}`;
    for (const [suffix, blocked, until] of [
      ['blocked', true, new Date(Date.now() + 3 * 86400000).toISOString()],
      ['expired', true, '2020-01-01T00:00:00Z'], ['indefinite', true, null], ['open', false, null],
    ] as const) {
      await graph('CREATE (:User {id:$id, firstName:$name, email:$email, profilePicture:$photo, isBlocked:$blocked, createdAt:"2026-10-15"})', {
        id: id(suffix), name: suffix, email: `${suffix}@example.test`, photo: '/user/tutor/profile/photo.png', blocked,
      });
      if (until) await graph('MATCH (t:User {id:$id}) SET t.blockExpiresAt = datetime($until)', { id: id(suffix), until });
    }
    await graph(`MATCH (t:User {id:$id}) SET t.suspendedUntil = $until, t.suspendedReason = 'Separate account suspension'
      CREATE (p:Penalty {tutorId:$id, penaltyId:$penalty, penaltyCode:'601', createdAt:datetime()}) CREATE (t)-[:HAS_PENALTY]->(p)`,
      { id: id('blocked'), penalty: id('block-penalty'), until: new Date(Date.now() + 86400000).toISOString() });
    await graph(`MATCH (t:User {id:$id}) UNWIND [1, 2, 3] AS i CREATE (p:Penalty {tutorId:$id, penaltyId:$id + toString(i), penaltyCode:'301', createdAt:datetime()}) CREATE (t)-[:HAS_PENALTY]->(p)`, { id: id('blocked') });
  });
  afterAll(async () => {
    await graph('MATCH (n) WHERE n.id STARTS WITH $prefix OR n.tutorId STARTS WITH $prefix OR n.subjectId STARTS WITH $prefix OR n.userId STARTS WITH $prefix DETACH DELETE n', { prefix });
    await closeDriver();
  });
  test('list returns photos, active blocks and normalized expiry without treating expired blocks as active', async () => {
    const result = await new AdminService().getTutors({ status: 'all', limit: 20 });
    const tutors = result.tutors.filter(t => t.id.startsWith(prefix));
    expect(tutors).toHaveLength(4);
    for (const tutor of tutors) expect(tutor.profilePicture).toBe('/user/tutor/profile/photo.png');
    expect(tutors.find(t => t.id === id('blocked'))?.isBlocked).toBe(true);
    expect(tutors.find(t => t.id === id('blocked'))?.blockExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(tutors.find(t => t.id === id('expired'))?.isBlocked).toBe(false);
    expect(tutors.find(t => t.id === id('indefinite'))?.isBlocked).toBe(true);
    expect(tutors.find(t => t.id === id('open'))?.isBlocked).toBe(false);
  });
  test('unblock rejects missing auth, forged privileges, untrusted origins and blank reasons without changing state', async () => {
    expect([401, 403]).toContain((await request('')).status);
    expect((await request(support)).status).toBe(403);
    expect((await request(operator, 'Origin check', 'https://evil.example')).status).toBe(403);
    expect((await request(operator, '   ')).ok).toBe(false);
    const data = await graph('MATCH (t:User {id:$id}) RETURN t.isBlocked AS blocked', { id: id('blocked') });
    expect(data.records[0]!.get('blocked')).toBe(true);
    const session = getDriver().session();
    try { await expect(session.executeWrite(tx => assertTutorCanSchedule(tx, id('blocked')))).rejects.toThrow('temporarily blocked'); }
    finally { await session.close(); }
  });
  test('authorized lift is audited, waives automatic blocks for seven days and preserves penalties and suspension', async () => {
    const response = await request(operator);
    expect(response.status).toBe(200);
    const session = getDriver().session();
    try {
      await session.executeWrite(tx => reconcileTutorPenaltyBlock(tx, id('blocked')));
      await session.executeWrite(tx => assertTutorCanSchedule(tx, id('blocked')));
    } finally { await session.close(); }
    const tutors = (await new AdminService().getTutors({ status: 'all' })).tutors;
    const tutor = tutors.find(t => t.id === id('blocked'))!;
    expect(tutor.isBlocked).toBe(false);
    expect(tutor.isSuspended).toBe(true);
    expect(Date.parse(tutor.penaltyBlockOverrideUntil!) - Date.now()).toBeGreaterThan(6.9 * 86400000);
    const penalties = await graph('MATCH (p:Penalty {tutorId:$id}) RETURN p', { id: id('blocked') });
    expect(penalties.records.filter(row => row.get('p').properties.penaltyCode === '301')).toHaveLength(3);
    expect(penalties.records.find(row => row.get('p').properties.penaltyCode === '601')!.get('p').properties.status).toBe('voided');
    const audit = await graph('MATCH (a:AdminOperationsAudit {subjectId:$id, action:"booking_block_removed"}) RETURN a', { id: id('blocked') });
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]!.get('a').properties.actorId).toBe(id('operator'));
    expect(audit.records[0]!.get('a').properties.reason).toBe('Account reviewed and temporary block lifted.');
  });
});
