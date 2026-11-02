// Requires a fresh disposable graph; never runs against configured application storage.
import { expect, test } from 'bun:test';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { AdminService } from '../src/services/admin.services/admin.service';
import { InterviewService } from '../src/services/interview.services/interview.service';
import { signAuthToken } from '../src/utils/jwt';
import Elysia from 'elysia';

test('full application catalog preserves interview results, accurate counts, pagination and admin boundaries', async () => {
  if (process.env.APPLICATION_CATALOG_TEST_URI !== 'bolt://127.0.0.1:17726') throw Error('Use the disposable application catalog graph on port 17726');
  process.env.JWT_SECRET = 'application-catalog-fixture-not-a-production-key';
  await initDriver(process.env.APPLICATION_CATALOG_TEST_URI, '', '', 3, 500);
  const session = getDriver().session();
  let ownsFixture = false;
  try {
    expect((await session.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n').toNumber()).toBe(0);
    ownsFixture = true;
    await session.run(`UNWIND $users AS user CREATE (u:User) SET u=user`, { users: Array.from({ length: 55 }, (_, i) => ({
      id: `catalog-new-${i}`, role: 'tutor', firstName: 'Applicant', email: `new-${i}@example.invalid`, createdAt: '2026-10-28T01:00:00Z',
    })) });
    await session.run(`CREATE (u:User {id:'catalog-pass',role:'tutor',firstName:'Passed',email:'pass@example.invalid',createdAt:'2020-01-01',
      writtenExamPassed:true,speakingExamPassed:true,profileStatus:'incomplete'}),
      (u)-[:TAKES]->(:Exam {id:'catalog-written',type:'written',status:'completed',result:'{"passed":true}'}),
      (u)-[:TAKES]->(:Exam {id:'catalog-speaking',type:'speaking',status:'completed',result:'{"passed":true}'}),
      (:InterviewSlot {id:'catalog-pass-slot',tutorId:'catalog-pass',status:'completed',result:'pass',date:'2026-10-28',bookedAt:'2026-10-28T01:00:00Z',reviewedAt:'2026-10-28T02:00:00Z'}),
      (:User {id:'catalog-profile',role:'tutor',firstName:'Profile',email:'profile@example.invalid',writtenExamPassed:true,speakingExamPassed:true,profileStatus:'pending_review'}),
      (:InterviewSlot {id:'catalog-profile-slot',tutorId:'catalog-profile',status:'completed',result:'pass',bookedAt:'2026-10-28T01:00:00Z'}),
      (:User {id:'catalog-approved',role:'tutor',writtenExamPassed:true,speakingExamPassed:true,interviewPassed:true,profileStatus:'approved'}),
      (:User {id:'catalog-fail',role:'tutor',writtenExamPassed:true,speakingExamPassed:true,interviewPassed:true,profileStatus:'approved'}),
      (:InterviewSlot {id:'catalog-old-pass',tutorId:'catalog-fail',status:'completed',result:'pass',bookedAt:'2026-10-26T01:00:00Z'}),
      (:InterviewSlot {id:'catalog-new-fail',tutorId:'catalog-fail',status:'completed',result:'fail',bookedAt:'2026-10-28T01:00:00Z'}),
      (:User {id:'catalog-waiver',role:'tutor',profileStatus:'approved',manualTestQualification:true,manualTestQualificationPurpose:'salary_testing',manualTestQualificationAt:'2026-10-28',manualTestQualificationBy:'fixture'}),
      (:User {id:'catalog-student',role:'student'}),(:User {id:'catalog-admin-user',role:'admin'}),
      (:Admin {id:'catalog-operations',role:'admin',permissions:['operations']}),(:Admin {id:'catalog-support',role:'admin',permissions:['support']})`);
    const admin = new AdminService();
    const first = await admin.getApplications('all', 1, 10);
    expect(first.total).toBe(60);
    expect(first.items).toHaveLength(10);
    expect(first.counts).toMatchObject({ total: 60, interviewPassed: 3, interviewFailed: 1, pendingProfile: 1, certified: 1, pendingWritten: 56 });
    expect(first.items.some(item => item.id === 'catalog-pass')).toBe(false);
    const passed = await admin.getApplications('interview_passed');
    expect(passed.items.find(item => item.id === 'catalog-pass')).toMatchObject({ interviewSlotId: 'catalog-pass-slot', status: 'interview_passed' });
    expect(passed.items.find(item => item.id === 'catalog-profile')?.status).toBe('pending_profile');
    expect(passed.items.some(item => item.id === 'catalog-fail')).toBe(false);
    expect((await admin.getApplications('interview_failed')).items[0]?.interviewSlotId).toBe('catalog-new-fail');
    expect((await admin.getApplications('all', 99)).page).toBe(6);
    expect((await admin.getApplications('all', 6)).items).toHaveLength(10);
    expect((await admin.getPendingTutors(100)).some(item => item.id === 'catalog-pass')).toBe(false);
    await expect(admin.getApplications('invalid')).rejects.toThrow('Invalid');
    await expect(admin.getApplications('all', 0)).rejects.toThrow('Invalid');
    await expect(admin.getApplications('all', 1, 500)).rejects.toThrow('Invalid');
    const { default: AdminRoutes } = await import('../src/routes/admin.route');
    const api = new Elysia().use(AdminRoutes);
    const token = async (id: string, role = 'admin') => signAuthToken({ userId: id, email: 'fixture@example.invalid', role } as any);
    const request = async (auth?: string, query = '') => api.handle(new Request(`http://localhost/admin/applications${query}`, {
      headers: auth ? { Cookie: `adminAuth=${auth}` } : {},
    }));
    expect((await request()).status).toBe(401);
    expect((await request(await token('catalog-support'))).status).toBe(403);
    expect((await request(await token('catalog-pass', 'tutor'))).status).toBe(403);
    const allowed = await request(await token('catalog-operations'), '?filter=interview_passed');
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('cache-control')).toBe('private, no-store');
    const payload = await allowed.json() as { data: { total: number } };
    expect(payload.data.total).toBe(3);
    expect((await request(await token('catalog-operations'), '?page=NaN')).status).toBe(400);
    await new InterviewService().saveInterviewResult({ slotId: 'catalog-pass-slot', tutorId: 'catalog-pass', result: 'fail',
      rubricScores: { grammar: 2, fluency: 2, pronunciation: 2, vocabulary: 2, professionalism: 2 }, notes: 'Reviewed', timestamps: [], adminId: 'catalog-operations' });
    const corrected = await admin.getApplications('interview_failed');
    expect(corrected.counts.interviewPassed).toBe(2);
    expect(corrected.counts.interviewFailed).toBe(2);
    expect(corrected.items.some(item => item.id === 'catalog-pass')).toBe(true);
  } finally {
    if (ownsFixture) await session.run('MATCH(n) DETACH DELETE n');
    await session.close();
    await closeDriver();
  }
}, 15000);
