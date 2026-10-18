import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import Workflow from '../src/routes/lessonWorkflow.route';
import Schedule from '../src/routes/schedule.route';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { signAuthToken } from '../src/utils/jwt';
import { query } from '../src/db/postgres';
import { LessonWorkflowService } from '../src/services/lessonWorkflow.service';
import { ClassroomNotesService } from '../src/services/classroomNotes.services/classroomNotes.service';
import { StudentLessonService } from '../src/services/studentLesson.service';
import { LessonIssueReviewService } from '../src/services/lessonIssueReview.service';
import { StudentLessonIssueReportService } from '../src/services/studentLessonIssueReport.service';

const suite = process.env.LESSON_NOTES_TEST_URI ? describe : describe.skip;
const prefix = `workflow-test-${crypto.randomUUID()}`;
const tutor = `${prefix}-tutor`, student = `${prefix}-student`, admin = `${prefix}-admin`;
const id = (name: string) => `${prefix}-${name}`;
const workflow = new LessonWorkflowService(), notes = new ClassroomNotesService(), recap = new StudentLessonService(), reviews = new LessonIssueReviewService();
const feedback = 'Hello! You expressed your ideas clearly today. Keep practicing the new vocabulary and pronunciation before your next lesson.';
const app = new Elysia().use(Workflow);
const scheduleApp = new Elysia().use(Schedule);
const productionErrorsApp = new Elysia().onError(({ set }) => {
  set.status = 500;
  return { success: false, error: 'An unexpected error occurred. Please try again.' };
}).use(Workflow);
let tutorCookie = '', studentCookie = '', adminCookie = '';
const request = (path: string, cookie: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => app.handle(new Request(`http://localhost/lesson-workflow${path}`, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
const run = async (text: string, params: Record<string, any> = {}) => { const session = getDriver().session(); try { return await session.run(text, params); } finally { await session.close(); } };
const raw = async (name: string) => (await run('MATCH (b:Booking {bookingId: $id}) RETURN b', { id: id(name) })).records[0]!.get('b').properties;
const saveMaterial = (name: string, materialType = 'daily-dispatch', materialId = id('article')) => notes.saveNotes({
  sessionId: id(name), tutorId: tutor, studentId: student, materialType, materialId, materialTitle: materialType === 'daily-dispatch' ? 'Science article' : 'Business introductions',
  isUsed: true, courseId: materialType, lessonId: materialType === 'daily-dispatch' ? null : materialId, articleId: materialType === 'daily-dispatch' ? materialId : null,
  vocabularyItems: [], grammarItems: [], pronunciationItems: [] });

suite('lesson workflow (local Memgraph and Postgres)', () => {
  beforeAll(async () => {
    await initDriver(process.env.LESSON_NOTES_TEST_URI!, process.env.MEMGRAPH_USER || 'fluentxverse', process.env.MEMGRAPH_PASSWORD || '', 1);
    tutorCookie = `tutorAuth=${await signAuthToken({ userId: tutor, email: 'tutor@test.local', role: 'tutor' })}`;
    studentCookie = `studentAuth=${await signAuthToken({ userId: student, email: 'student@test.local', role: 'student' })}`;
    adminCookie = `adminAuth=${await signAuthToken({ userId: admin, email: 'admin@test.local', role: 'admin' })}`;
    await run('CREATE (:Student {id: $student}), (:User {id: $tutor})', { student, tutor });
    const fixtures = ['ended', 'ongoing', 'future', 'expired', 'absent', 'tutor-absent', 'cancelled', 'continuation', 'later', 'validation'].map(name => ({ name, id: id(name),
      start: new Date(Date.now() + (name === 'future' ? 3600_000 : name === 'ongoing' ? -60_000 : name === 'expired' ? -72 * 3600_000 : name === 'continuation' ? -2 * 3600_000 : -3600_000)).toISOString(),
      status: name === 'cancelled' ? 'cancelled' : 'confirmed', studentStatus: name === 'absent' ? 'absent' : null, tutorStatus: name === 'tutor-absent' ? 'absent' : 'present' }));
    await run(`UNWIND $fixtures AS f MATCH (s:Student {id: $student})
      CREATE (:Booking {bookingId: f.id, tutorId: $tutor, status: f.status, durationMinutes: 25, slotDateTime: datetime(f.start), attendanceTutor: f.tutorStatus, attendanceStudent: f.studentStatus})-[:BOOKED_BY]->(s)`, { fixtures, student, tutor });
    await run("CREATE (:DispatchArticle {id: $id, title: 'Science article', status: 'published', postedDate: '2026-01-01'})", { id: id('article') });
  });
  afterAll(async () => {
    await query('DELETE FROM lesson_trouble_reports WHERE booking_id LIKE $1', [`${prefix}%`]);
    await query('DELETE FROM student_lesson_issue_reports WHERE booking_id LIKE $1', [`${prefix}%`]);
    await run(`MATCH (n) WHERE n.bookingId STARTS WITH $prefix OR n.sessionId STARTS WITH $prefix OR n.id STARTS WITH $prefix
      OR n.userId IN $users OR n.actorId IN $users OR n.studentId = $student OR n.tutorId = $tutor DETACH DELETE n`, { prefix, users: [tutor, student, admin], student, tutor });
    await closeDriver();
  });
  test('owner scoping, role authentication, and admin archives are enforced', async () => {
    expect((await request(`/tutor/${id('ended')}`, '')).status).toBe(401);
    expect((await request(`/tutor/${id('ended')}`, studentCookie)).status).toBe(401);
    expect((await request('/tutor/missing', tutorCookie)).status).toBe(403);
    expect((await request(`/student/${id('ended')}`, studentCookie)).status).toBe(200);
    expect((await request(`/admin/attendance/${id('ended')}`, tutorCookie)).status).toBe(401);
    expect((await request(`/admin/attendance/${id('ended')}`, studentCookie)).status).toBe(401);
    const rolelessCookie = `adminAuth=${await signAuthToken({ userId: admin, email: 'legacy@test.local' })}`;
    expect((await request(`/admin/attendance/${id('ended')}`, rolelessCookie)).status).toBe(403);
  });
  test('tutor reports require a student issue and expose it to admin review without changing attendance', async () => {
    const report = (body: unknown, cookie = tutorCookie) => scheduleApp.handle(new Request(
      `http://localhost/schedule/tutor-lesson/${id('ongoing')}/trouble-report`,
      { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const before = await raw('ongoing');
    expect((await report({ duration: 'up_to_ten', reason: 'student' }, '')).status).toBe(401);
    const missing = await report({ duration: 'up_to_ten', reason: 'student' });
    expect(missing.status).toBe(400);
    expect((await missing.json() as any).error).toBe('Choose what happened with the student.');
    expect((await report({ duration: 'up_to_ten', reason: 'audio', studentIssue: 'late' })).status).toBe(400);
    expect((await report({ duration: 'up_to_ten', reason: 'student', studentIssue: 'other' })).status).toBe(422);
    const saved = await report({ duration: 'up_to_ten', reason: 'student', studentIssue: 'asked_to_cancel' });
    expect(saved.status).toBe(200);
    expect((await saved.json() as any).data.studentIssueLabel).toBe('Student asked to cancel');
    expect((await report({ duration: 'up_to_ten', reason: 'student', studentIssue: 'late' })).status).toBe(409);
    const listed = (await reviews.list()).find((entry: { bookingId: string; source: string }) => entry.bookingId === id('ongoing') && entry.source === 'tutor');
    expect(listed?.studentIssue).toBe('asked_to_cancel');
    expect(listed?.studentIssueLabel).toBe('Student asked to cancel');
    const after = await raw('ongoing');
    expect(after.status).toBe(before.status);
    expect(after.attendanceTutor).toBe(before.attendanceTutor);
    expect(after.attendanceStudent).toBe(before.attendanceStudent);
  });
  test('default Present stays unverified and draft content is private', async () => {
    await saveMaterial('ended');
    await notes.saveLessonNotes(id('ended'), tutor, feedback, 'Private tutor handoff');
    const state = await workflow.get(id('ended'), student, 'student');
    expect(state.studentAttendance).toBe('present'); expect(state.attendanceVerified).toBe(false); expect(state.notesStatus).toBe('draft');
    const data = await recap.getRecap(id('ended'), student);
    expect(data.studentComment).toBe(''); expect(data.materials).toHaveLength(0);
    expect(JSON.stringify(data)).not.toContain('Private tutor handoff');
  });
  test('submission validation survives the global error handler and leaves drafts unpublished', async () => {
    const submit = async (name = 'validation') => {
      const url = `${process.env.PERFORMANCE_LIVE_TEST_URL || 'http://localhost'}/lesson-workflow/tutor/${id(name)}/submit`;
      const init = { method: 'POST', headers: { cookie: tutorCookie } };
      return process.env.PERFORMANCE_LIVE_TEST_URL ? fetch(url, init) : productionErrorsApp.handle(new Request(url, init));
    };
    await saveMaterial('validation', 'business-english', id('business'));
    await run(`CREATE (:ClassroomLessonNote {sessionId: $id, studentComment: 'Hello!', tutorMemo: ''})`, { id: id('validation') });
    for (const [studentComment, tutorMemo, expected] of [
      ['Hello!', '', 'Student feedback must contain at least 100 characters.'],
      [feedback, 'x'.repeat(151), 'Tutor handoff must not exceed 150 characters.'],
      [feedback, '', 'Choose a stopping point for Business introductions.'],
    ] as const) {
      await run('MATCH (n:ClassroomLessonNote {sessionId: $id}) SET n.studentComment = $studentComment, n.tutorMemo = $tutorMemo', { id: id('validation'), studentComment, tutorMemo });
      const response = await submit();
      expect(response.status).toBe(400);
      const result = await response.json() as any;
      expect(result.error).toBe(expected);
      expect(result.validation.field).toBe(expected.startsWith('Student') ? 'studentFeedback' : expected.startsWith('Tutor') ? 'tutorHandoff' : 'stoppingPoint');
      if (result.validation.field === 'stoppingPoint') expect(result.validation).toEqual({ field: 'stoppingPoint', materialType: 'business-english', materialId: id('business') });
      const booking = await raw('validation');
      expect(booking.notesSubmittedAt).toBeUndefined();
      expect(booking.attendanceStudent).toBeUndefined();
      const published = await run('MATCH (n:PublishedLessonNotes {sessionId: $id}) RETURN count(n) AS count', { id: id('validation') });
      expect(Number(published.records[0]!.get('count'))).toBe(0);
    }
    const expired = await submit('expired');
    expect(expired.status).toBe(403);
    expect((await expired.json() as any).error).toContain('within 48 hours');
    await run("MATCH (n:ClassroomMaterialNote {sessionId: $id}) SET n.completionStatus = 'completed'", { id: id('validation') });
    expect((await submit()).status).toBe(200);
    expect((await raw('validation')).attendanceStudent).toBe('present');
    await run('MATCH (n:Notification {userId: $student}) WHERE n.data CONTAINS $id DETACH DELETE n', { student, id: id('validation') });
  });
  test('submission confirms attendance, publishes whitelisted feedback, and is idempotent', async () => {
    const response = await request(`/tutor/${id('ended')}/submit`, tutorCookie, {});
    expect(response.status).toBe(200);
    const state = ((await response.json()) as any).data;
    expect(state.notesStatus).toBe('submitted'); expect(state.attendanceVerified).toBe(true); expect(state.outcome).toBe('attended');
    const data = await recap.getRecap(id('ended'), student);
    expect(data.studentComment).toBe(feedback); expect(data.materials).toHaveLength(1); expect(JSON.stringify(data)).not.toContain('Private tutor handoff');
    const count = async () => Number((await run('MATCH (n:Notification {userId: $student}) RETURN count(n) AS count', { student })).records[0]!.get('count'));
    expect(await count()).toBe(1);
    await workflow.submit(id('ended'), tutor); expect(await count()).toBe(1);
    expect((await raw('ended')).status).toBe('completed'); expect((await raw('ended')).attendanceStatus).toBe('present');
  });
  test('updates remain drafts while students see the last submitted version', async () => {
    await notes.saveLessonNotes(id('ended'), tutor, `${feedback} New update.`, 'Private update');
    expect((await workflow.get(id('ended'), tutor, 'tutor')).notesStatus).toBe('changes_pending');
    expect((await recap.getRecap(id('ended'), student)).studentComment).toBe(feedback);
    await workflow.submit(id('ended'), tutor);
    expect((await recap.getRecap(id('ended'), student)).studentComment).toContain('New update.');
  });
  test('submission rejects invalid progress, incomplete feedback, absences, and timing boundaries', async () => {
    await saveMaterial('later', 'business-english', id('business'));
    await notes.saveLessonNotes(id('later'), tutor, feedback, '');
    await expect(workflow.submit(id('later'), tutor)).rejects.toThrow('stopping point');
    await expect(workflow.submit(id('ongoing'), tutor)).rejects.toThrow('after');
    await expect(workflow.submit(id('future'), tutor)).rejects.toThrow('after');
    await expect(workflow.submit(id('expired'), tutor)).rejects.toThrow('within 48');
    await expect(workflow.submit(id('absent'), tutor)).rejects.toThrow('not required');
    await expect(workflow.submit(id('tutor-absent'), tutor)).rejects.toThrow('not required');
    await expect(workflow.submit(id('cancelled'), tutor)).rejects.toThrow();
    await expect(notes.saveLessonNotes(id('expired'), tutor, feedback, '')).rejects.toThrow('closed');
    await expect(notes.saveLessonNotes(id('ongoing'), tutor, 'too short', '')).rejects.toThrow();
  });
  test('finalization and deadline notices are idempotent and do not invent attendance', async () => {
    const ids = ['ongoing', 'future', 'expired', 'absent', 'tutor-absent', 'cancelled', 'later'].map(id);
    await workflow.reconcile(Date.now(), ids); await workflow.reconcile(Date.now(), ids);
    expect((await raw('ongoing')).status).toBe('confirmed'); expect((await raw('future')).status).toBe('confirmed');
    expect((await raw('expired')).status).toBe('completed'); expect((await raw('expired')).lessonOutcome).toBe('attended');
    expect((await raw('expired')).attendanceStudent).toBeUndefined();
    expect((await raw('absent')).lessonOutcome).toBe('attended'); expect((await raw('tutor-absent')).lessonOutcome).toBe('tutor_absent');
    expect((await raw('cancelled')).status).toBe('cancelled');
    expect((await workflow.pending(tutor)).some(item => item.bookingId === id('expired') && item.closed)).toBe(true);
    const count = Number((await run("MATCH (n:Notification {id: $id}) RETURN count(n) AS count", { id: `notes-reminder:${id('expired')}:overdue` })).records[0]!.get('count'));
    expect(count).toBe(1);
  });
  test('continuations use the latest outcome per material and never copy learning notes', async () => {
    await saveMaterial('continuation', 'business-english', id('unfinished'));
    await run("MATCH (n:ClassroomMaterialNote {sessionId: $sessionId}) SET n.completionStatus = 'in_progress', n.stoppedAt = 'practice', n.stoppedAtLabel = 'Practice'", { sessionId: id('continuation') });
    const items = await workflow.continuations(id('future'), student, 'student');
    expect(items.some(item => item.materialId === id('unfinished') && item.stoppedAtLabel === 'Practice')).toBe(true);
    expect(JSON.stringify(items)).not.toContain('vocabularyItems');
    await run("MATCH (n:ClassroomMaterialNote {sessionId: $sessionId}) SET n.completionStatus = 'completed'", { sessionId: id('continuation') });
    expect((await workflow.continuations(id('future'), student, 'student')).some(item => item.materialId === id('unfinished'))).toBe(false);
  });
  test('absence archives published notes and admin recovery preserves privacy and ownership', async () => {
    await notes.saveLessonNotes(id('ended'), tutor, `${feedback} Pending recovery update.`, 'Private recovery draft');
    await notes.setStudentAttendance(id('ended'), tutor, 'absent', 'Student did not attend');
    expect((await recap.getRecap(id('ended'), student)).materials).toHaveLength(0);
    const history = await reviews.attendanceHistory(id('ended'));
    const archive = history.find(a => a.canRestore)!;
    expect(archive.actorId).toBe(tutor); expect(archive.snapshotJson).toBeUndefined();
    expect((await request(`/admin/attendance/${id('ended')}/restore/${archive.id}`, studentCookie, { reason: 'Recovery' })).status).toBe(401);
    await expect(reviews.restore(id('later'), archive.id, admin, 'wrong lesson')).rejects.toThrow('not found');
    await reviews.restore(id('ended'), archive.id, admin, 'Attendance marking error confirmed');
    expect((await recap.getRecap(id('ended'), student)).studentComment).toContain('New update.');
    expect((await recap.getRecap(id('ended'), student)).studentComment).not.toContain('Pending recovery update.');
    expect((await notes.getLessonNotes(id('ended'), tutor))?.studentComment).toContain('Pending recovery update.');
    expect((await workflow.get(id('ended'), tutor, 'tutor')).notesStatus).toBe('changes_pending');
    expect((await raw('ended')).attendanceStudent).toBe('present');
    await expect(reviews.restore(id('ended'), archive.id, admin, 'duplicate')).rejects.toThrow('only available');
  });
  test('report review exposes resolution and rejects unverified ticket references', async () => {
    const reports = new StudentLessonIssueReportService();
    const report = await reports.create(id('ended'), student, 'over_ten', 'audio', 'Microphone issue');
    expect(report?.status).toBe('submitted');
    expect((await reports.getForTutor(id('ended'), tutor))?.id).toBe(report!.id);
    await expect(reports.getForTutor(id('ended'), 'another-tutor')).rejects.toThrow('do not have access');
    await reports.dispatchTutorNotifications(); await reports.dispatchTutorNotifications();
    const notifications = await run('MATCH (n:Notification {id: $id}) RETURN n', { id: `report:${report!.id}:received:tutor` });
    expect(notifications.records).toHaveLength(1);
    expect(notifications.records[0]!.get('n').properties.userId).toBe(tutor);
    expect(JSON.parse(notifications.records[0]!.get('n').properties.data).bookingId).toBe(id('ended'));
    await expect(reviews.review('student', report!.id, admin, 'resolved', '')).rejects.toThrow('resolution');
    await expect(reviews.review('student', report!.id, admin, 'resolved', 'Resolved', 'not-a-refund')).rejects.toThrow('completed refund');
    await reviews.review('student', report!.id, admin, 'under_review', 'Checking connection logs.');
    expect((await reports.get(id('ended'), student))?.status).toBe('under_review');
    await reviews.correctAttendance(id('ended'), admin, 'present', 'Review verified attendance');
    await reviews.review('student', report!.id, admin, 'resolved', 'Attendance verified; no ticket adjustment required.');
    const resolved = await reports.get(id('ended'), student);
    expect(resolved?.status).toBe('resolved'); expect(resolved?.attendanceCorrection).toBe('present');
    expect(resolved?.resolution).toContain('Attendance verified');
  });
  test('admin tutor corrections retain their subject, actor, reason, and outcome', async () => {
    await reviews.correctAttendance(id('ended'), admin, 'absent', 'Room logs confirm the tutor did not attend', 'tutor');
    expect((await raw('ended')).lessonOutcome).toBe('tutor_absent');
    expect((await raw('ended')).attendanceStatus).toBe('absent');
    expect((await workflow.get(id('ended'), student, 'student')).notesStatus).toBe('not_required');
    const history = await reviews.attendanceHistory(id('ended'));
    expect(history.some(a => a.subject === 'tutor' && a.actorId === admin && a.status === 'absent' && a.reason.includes('Room logs'))).toBe(true);
    await reviews.correctAttendance(id('ended'), admin, 'present', 'Correction reviewed', 'tutor');
    expect((await raw('ended')).lessonOutcome).toBe('attended');
    expect((await raw('ended')).attendanceStatus).toBe('present');
    expect((await raw('ended')).studentAttendanceUpdatedBy).toBe(admin);
  });
  test('submitting feedback does not invent tutor attendance', async () => {
    await run('MATCH (b:Booking {bookingId: $id}) REMOVE b.attendanceTutor', { id: id('ended') });
    await workflow.submit(id('ended'), tutor);
    expect((await raw('ended')).attendanceStudent).toBe('present');
    expect((await raw('ended')).attendanceTutor).toBeUndefined();
    expect((await raw('ended')).attendanceStatus).toBeUndefined();
    expect((await workflow.get(id('ended'), student, 'student')).outcome).toBe('awaiting_verification');
  });
});
