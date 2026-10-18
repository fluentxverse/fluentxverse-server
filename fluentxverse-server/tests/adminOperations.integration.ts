import { strict as assert } from 'node:assert';
import Elysia from 'elysia';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { query, closePool } from '../src/db/postgres';
import { adminOperationsService as ops } from '../src/services/admin.services/operations.service';
import { lessonIssueReviewService as issues, reviewFields } from '../src/services/lessonIssueReview.service';
import { AdminService } from '../src/services/admin.services/admin.service';
import { adminOperationsRoute } from '../src/routes/adminOperations.route';
import { signAuthToken } from '../src/utils/jwt';
import { reconcileTutorPenaltyBlock } from '../src/services/schedule.services/tutorPenaltyBlock';
import { CancellationRefundService, cancellationRefundService } from '../src/services/ticket.services/cancellationRefund.service';
import { lessonWorkflowService } from '../src/services/lessonWorkflow.service';

if (!process.env.TEST_MEMGRAPH_URI?.includes(':7693') || !process.env.DATABASE_URL?.includes(':5434')) throw new Error('Use isolated graph :7693 and Postgres :5434');
await initDriver(process.env.TEST_MEMGRAPH_URI, '', '', 1);
const db = getDriver().session(), now = Date.now();
const user = 'ops-tutor', student = 'ops-student', admin = 'ops-admin';
const day = (ms: number) => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const time = (ms: number) => new Date(ms + 8 * 3600000).toISOString().slice(11, 16);
const start = Math.ceil(now / 1800000) * 1800000 + 3600000;
try {
  await db.run('MATCH (n) DETACH DELETE n');
  await query("DELETE FROM student_lesson_issue_reports WHERE id='ops-report'").catch(() => {});
  await db.run("CREATE (:Admin {id: $admin, role: 'superadmin'}), (:Admin {id: 'ops-qa', role: 'admin', permissions: ['qa']}), (:Student {id: $student, givenName: 'Student', password: 'secret'}), (:User {id: $user, givenName: 'Tutor', password: 'secret'})", { admin, student, user });
  for (const [id, ms, status, attendance] of [['future', start, 'confirmed', 'present'], ['ended', now - 72 * 3600000, 'confirmed', 'present'], ['absent', now - 3600000, 'confirmed', 'absent'], ['past', now - 3600000, 'confirmed', 'present']] as const) {
    await db.run(`MATCH (t:User {id: $user}), (s:Student {id: $student})
      CREATE (t)-[:OPENS_SLOT]->(slot:TimeSlot {slotId: $id, tutorId: $user, slotDate: $date, slotTime: $time, durationMinutes: 25, status: 'booked', openedAt: datetime()})
      CREATE (b:Booking {bookingId: $id, slotId: $id, tutorId: $user, studentId: $student, status: $status,
        attendanceTutor: 'present', attendanceStudent: $attendance, slotDateTime: datetime($start), durationMinutes: 25})-[:BOOKS]->(slot)
      CREATE (b)-[:BOOKED_BY]->(s)`, { user, student, id, date: day(ms), time: time(ms), start: new Date(ms).toISOString(), status, attendance });
  }
  const target = start + 3600000;
  await db.run(`MATCH (t:User {id: $user}) CREATE (t)-[:OPENS_SLOT]->(:TimeSlot {slotId: 'target', tutorId: $user, slotDate: $date, slotTime: $time, status: 'open', durationMinutes: 25})`, { user, date: day(target), time: time(target) });
  await issues.list();
  await query("CREATE TABLE IF NOT EXISTS qa_recordings (id TEXT, booking_id TEXT, local_status TEXT, expires_at TIMESTAMPTZ)");
  await query("INSERT INTO student_lesson_issue_reports (id,booking_id,student_id,duration,reason) VALUES ('ops-report','ended',$1,'up_to_ten','tutor')", [student]);
  await ops.reopen('ended', admin, 24, 'Validated classroom evidence');
  await assert.rejects(ops.reopen('absent', admin, 24, 'No notes for absent students'));
  await assert.rejects(ops.reopen('future', admin, 24, 'Not ended'));
  await assert.rejects(ops.reopen('ended', admin, 0, 'Bad window'));
  await assert.rejects(ops.reopen('ended', admin, 24, '  '));
  const detail = await ops.detail('ended', ['support']);
  assert.equal(detail.notesState.canEdit, true);
  assert(!JSON.stringify(detail.student).includes('secret'));
  assert(detail.audits.some((a: any) => a.action === 'notes_reopened'));
  await db.run("CREATE (:ClassroomLessonNote {sessionId: 'ended', studentComment: $comment, tutorMemo: 'Next lesson handoff'})", { comment: 'Hello! '.repeat(20) });
  await lessonWorkflowService.submit('ended', user);
  assert.equal((await ops.detail('ended', ['support'])).versions.length, 1);
  await db.run("CREATE (:LessonSurvey {bookingId: 'ended', tutorId: $user, rating: 5, positive: ['connection'], improvement: [], comment: 'QA PRIVATE'})", { user });
  assert.equal((await ops.detail('ended', ['qa'])).survey.comment, 'QA PRIVATE');
  assert.equal((await ops.detail('ended', ['support'])).survey.comment, undefined);
  const caseRow = await issues.updateCase('student', 'ops-report', admin, 'ops-qa', 'urgent', 'PRIVATE INTERNAL UPDATE');
  assert.equal(caseRow.priority, 'urgent'); assert.equal(caseRow.internalHistory.length, 1);
  assert(!JSON.stringify(reviewFields((await query("SELECT * FROM student_lesson_issue_reports WHERE id='ops-report'")).rows[0])).includes('PRIVATE'));
  assert((await ops.audits('ended')).some((a: any) => a.action === 'issue_internal_update'));
  await assert.rejects(ops.schedule('past', admin, 'cancel', 'Too late'));
  await assert.rejects(ops.schedule('future', admin, 'reschedule', 'Unavailable', 'missing'));
  await ops.schedule('future', admin, 'reschedule', 'Student requested a different time', 'target');
  const moved = await ops.detail('future', []); assert.equal(moved.booking.slotId, 'target'); assert.equal(moved.booking.slotDateTime, new Date(target).toISOString());
  assert.equal((await ops.slots(day(target), day(target), user)).find((s: any) => s.slotId === 'target')?.status, 'booked');
  await ops.schedule('future', admin, 'cancel', 'Student requested cancellation');
  assert.equal((await ops.detail('future', [])).booking.status, 'cancelled');
  await assert.rejects(ops.schedule('future', admin, 'cancel', 'Duplicate cancellation'));
  const stats = await new AdminService().getSessionStats();
  assert.equal(stats.completedSessions, 3); assert.equal(stats.upcomingSessions, 0); assert.equal(stats.noShowSessions, 0);
  assert.equal(stats.totalHours, 1.25);
  const wallet = '0x1111111111111111111111111111111111111111';
  process.env.VAULT_WALLET_ADDRESS = wallet;
  await db.run("CREATE (:TicketTransaction {id:'ops-original', bookingId:'ended', studentId:$student, studentWallet:$wallet, tokenId:'1', tier:'basic', quantity:1, type:'booking', status:'completed'})", { student, wallet });
  let transfers = 0;
  const fakeRefund = new CancellationRefundService({ configured: () => true, contractWrite: async () => { transfers++; return { id: 'fake-refund', status: 'mined', transactionHash: '0xfake' }; } } as any);
  cancellationRefundService.process = fakeRefund.process.bind(fakeRefund);
  await ops.refund('ended', admin, 'Approved lesson refund');
  await ops.refund('ended', admin, 'Duplicate retry');
  assert.equal(transfers, 1);
  assert.equal((await ops.detail('ended', ['finance'])).booking.refunded, true);
  await db.run("MATCH (b:Booking {bookingId:'past'}) SET b.refundStatus='review'");
  await assert.rejects(ops.refund('past', admin, 'Must not replay uncertain transfer'));
  await db.run("MATCH (t:User {id: $user}) SET t.isBlocked=true CREATE (p:Penalty {penaltyId:'ops-penalty', tutorId:$user, bookingId:'ended', slotId:'ended', penaltyCode:'301', createdAt:datetime()}) CREATE (t)-[:HAS_PENALTY]->(p)", { user });
  assert((await ops.penaltyPreview('ops-penalty')).proposed! >= (await ops.penaltyPreview('ops-penalty')).current!);
  await ops.changePenalty('ops-penalty', admin, 'Room evidence confirms attendance');
  await ops.changePenalty('ops-penalty', admin, 'Retry');
  assert.equal((await ops.audits('ended')).filter((a: any) => a.action === 'penalty_revoked').length, 1);
  await ops.unblock(user, admin, 'Reviewed account restriction');
  await db.executeWrite(tx => reconcileTutorPenaltyBlock(tx, user));
  assert.equal((await ops.people('tutor', user, [])).person.isBlocked, false);
  await ops.permissions('ops-qa', admin, ['support'], 'Support reassignment');
  assert.deepEqual((await ops.access('ops-qa')).permissions, ['support']);
  const token = await signAuthToken({ userId: 'ops-qa', email: 'qa@example.test', role: 'superadmin' });
  const app = new Elysia().use(adminOperationsRoute);
  const call = async (path: string, method = 'GET', body?: any, origin = 'http://localhost:5175') => app.handle(new Request(`http://localhost/admin/operations${path}`, { method, headers: { cookie: `adminAuth=${token}`, origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  assert.equal((await call('/surveys')).status, 403);
  assert.equal((await call('/payments')).status, 403);
  assert.equal((await call('/admins/ops-qa/permissions', 'PATCH', { permissions: ['qa'], reason: 'Privilege escalation' })).status, 403);
  assert.equal((await call('/lessons/ended/reopen', 'POST', { hours: 24, reason: 'External origin' }, 'https://evil.test')).status, 403);
  const res = await call('/lessons/ended/reopen', 'POST', { hours: 24, reason: 'Support authorized change' });
  assert.equal(res.status, 200, JSON.stringify(await res.json()));
  console.log('PASS: isolated operations transactions, canonical stats, QA privacy, case audit, penalty preview, permission revocation and CSRF');
} finally { await db.close(); await closeDriver(); await closePool(); }
