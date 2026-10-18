import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import Schedule from '../src/routes/schedule.route';
import Tutor from '../src/routes/tutor.route';
import { signAuthToken } from '../src/utils/jwt';
import { closeDriver, getDriver, initDriver } from '../src/db/memgraph';
import { StudentLessonService } from '../src/services/studentLesson.service';
import StudentService from '../src/services/auth.services/student.service';
import { query } from '../src/db/postgres';
import { ClassroomActivityService } from '../src/services/classroomActivity.services/classroomActivity.service';
import { SessionService } from '../src/services/session.services/session.service';
import { StudentLessonIssueReportService } from '../src/services/studentLessonIssueReport.service';
import { LessonIssueReviewService } from '../src/services/lessonIssueReview.service';

const uri = process.env.LESSON_NOTES_TEST_URI;
const suite = uri ? describe : describe.skip;
// Participant IDs in the legacy PostgreSQL schema are limited to 50 characters.
const fixture = `student-lesson-test-${crypto.randomUUID().slice(0, 20)}`;
const studentId = `${fixture}-student`, tutorId = `${fixture}-tutor`;
const upcoming = `${fixture}-upcoming`, past = `${fixture}-past`, next = `${fixture}-next`, ongoing = `${fixture}-ongoing`;
const cs = `${fixture}-cs`, be = `${fixture}-be`, article = `${fixture}-article`;
const service = new StudentLessonService();
const app = new Elysia().use(Schedule).use(Tutor);
let studentCookie: string, tutorCookie: string;
const request = (path: string, body?: unknown, cookie = studentCookie, method = body === undefined ? 'GET' : 'PUT') => app.handle(new Request(`http://localhost${path}`, {
  method, headers: { cookie, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));

suite('student lesson recap and advance material request (local Memgraph)', () => {
  beforeAll(async () => {
    await initDriver(uri!, process.env.MEMGRAPH_USER || 'fluentxverse', process.env.MEMGRAPH_PASSWORD || '', 1);
    studentCookie = `studentAuth=${await signAuthToken({ userId: studentId, email: 'student-recap@example.com', role: 'student' })}`;
    tutorCookie = `tutorAuth=${await signAuthToken({ userId: tutorId, email: 'tutor-recap@example.com', role: 'tutor' })}`;
    const session = getDriver().session();
    try {
      await session.run(`CREATE (:User {id: $tutorId, firstName: 'Recap', lastName: 'Tutor', testFixture: $fixture}),
        (student:Student {id: $studentId, lastViewedCourseId: 'daily-dispatch', lastViewedLessonId: $article, testFixture: $fixture})
        WITH student UNWIND $bookings AS row
        CREATE (:Booking {bookingId: row.id, tutorId: $tutorId, slotDateTime: datetime(row.startsAt), durationMinutes: 25,
          bookedAt: datetime(), status: row.status, attendanceStudent: 'present', testFixture: $fixture})-[:BOOKED_BY]->(student)`, {
        studentId, tutorId, fixture, article,
        bookings: [{ id: past, startsAt: new Date(Date.now() - 3600000).toISOString(), status: 'completed' },
          { id: upcoming, startsAt: new Date(Date.now() + 3600000).toISOString(), status: 'confirmed' },
          { id: next, startsAt: new Date(Date.now() + 7200000).toISOString(), status: 'confirmed' }],
      });
      await session.run(`UNWIND $materials AS row CREATE (:LessonMaterial {id: row.id, course: row.course, status: 'published',
        level: 3, chapter: 2, lessonNumber: 4, lessonName: 'Introductions', goalTextEn: 'Introduce yourself', testFixture: $fixture})`, {
        materials: [{ id: cs, course: 'conversational-skills' }, { id: be, course: 'business-english' }], fixture,
      });
      await session.run(`CREATE (:DispatchArticle {id: $article, title: 'Published science article', status: 'published', postedDate: '2026-01-01', testFixture: $fixture}),
        (:DispatchArticle {id: $draft, title: 'Private draft', status: 'draft', testFixture: $fixture}),
        (:DispatchArticle {id: $future, title: 'Future article', status: 'published', postedDate: '2099-01-01', testFixture: $fixture})`, { article, draft: `${fixture}-draft`, future: `${fixture}-future`, fixture });
      const vocabulary = [{ word: 'frontier', selectedDefinitionIndex: 0, definitions: [{ meaning: 'A new area of knowledge', partOfSpeech: 'noun',
        japaneseNative: 'フロンティア', japaneseRomanized: 'furontia', koreanNative: 'private old translation' }], showDefinition: false }];
      const grammar = [{ youSaid: 'I want to ate', correct: 'I want to eat', simpleExplanation: 'Private explanation', technicalExplanation: 'Private technical explanation' }];
      await session.run(`UNWIND $notes AS row CREATE (:ClassroomMaterialNote {id: row.id, sessionId: $past, materialType: row.type,
        materialId: row.materialId, courseId: row.type, isUsed: true, hasContent: true, completionStatus: row.completionStatus,
        stoppedAtLabel: row.stoppedAtLabel, progressDetails: 'Continue next time', vocabularyItemsJson: $vocabulary,
        grammarItemsJson: $grammar, pronunciationItemsJson: $pronunciation, tutorMemo: 'PRIVATE MATERIAL HANDOFF',
        studentComment: '', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', testFixture: $fixture})
        WITH count(*) AS created
        CREATE (:ClassroomLessonNote {sessionId: $past, studentComment: 'Hello! Keep practicing.', tutorMemo: 'PRIVATE SHARED HANDOFF',
          englishLevelAssessment: 4, updatedAt: '2026-10-01T00:00:00Z', testFixture: $fixture})`, {
        past, fixture, vocabulary: JSON.stringify(vocabulary), grammar: JSON.stringify(grammar), pronunciation: JSON.stringify([{ word: 'lasagna', phonetic: 'luh-ZAHN-yuh' }]),
        notes: [{ id: `${fixture}-note-cs`, materialId: cs, type: 'conversational-skills', completionStatus: 'in_progress', stoppedAtLabel: 'Part 3 - Step A' },
          { id: `${fixture}-note-dispatch`, materialId: article, type: 'daily-dispatch', completionStatus: 'completed', stoppedAtLabel: '' }],
      });
    } finally { await session.close(); }
  });
  afterAll(async () => {
    await query('DELETE FROM student_lesson_issue_reports WHERE student_id = $1', [studentId]);
    await query('DELETE FROM classroom_activity_logs WHERE session_id = $1', [ongoing]);
    await query('DELETE FROM session_participants WHERE session_id = $1', [ongoing]);
    const session = getDriver().session();
    try { await session.run(`MATCH (node) WHERE node.testFixture = $fixture OR node.studentId = $studentId OR node.userId = $tutorId DETACH DELETE node`, { fixture, studentId, tutorId }); }
    finally { await session.close(); await closeDriver(); }
  });

  test('independent request endpoint is scoped and does not require lesson notes', async () => {
    const response = await request(`/schedule/lesson-material-request/${upcoming}`);
    expect(response.status).toBe(200);
    const { data } = await response.json() as { data: { canRequestMaterial: boolean; materialRequest: unknown } };
    expect(data.canRequestMaterial).toBe(true); expect(data.materialRequest).toBeNull();
    expect((await request(`/schedule/lesson-material-request/${upcoming}`, undefined, '')).status).toBe(401);
    expect((await request(`/schedule/lesson-material-request/unknown`)).status).toBe(403);
  });

  test('student recap treats unset attendance as present without writing attendance', async () => {
    const session = getDriver().session();
    try {
      await session.run('MATCH (b:Booking {bookingId:$id}) REMOVE b.attendanceStudent', { id: upcoming });
      expect((await service.getRecap(upcoming, studentId)).studentAttendance).toBe('present');
      const response = await request(`/schedule/lesson-recap/${upcoming}`);
      expect((await response.json() as { data: { studentAttendance: string } }).data.studentAttendance).toBe('present');
      const result = await session.run('MATCH (b:Booking {bookingId:$id}) RETURN b.attendanceStudent AS attendance', { id: upcoming });
      expect(result.records[0]!.get('attendance')).toBeNull();
    } finally { await session.close(); }
  });

  test('recap whitelists public notes, grouping, metadata, translations, and navigation', async () => {
    const response = await request(`/schedule/lesson-recap/${past}`);
    expect(response.status).toBe(200);
    const { data } = await response.json() as { data: Awaited<ReturnType<StudentLessonService['getRecap']>> };
    expect(data.materials).toHaveLength(2);
    expect(data.studentComment).toBe('Hello! Keep practicing.');
    expect(data.englishLevelAssessment).toBe(4);
    expect(data.materials[0]!.materialLevel).toBe(3);
    expect(data.materials[0]!.materialChapter).toBe(2);
    expect(data.materials[0]!.stoppedAtLabel).toBe('Part 3 - Step A');
    expect(data.materials[0]!.vocabularyItems[0]!.definitions[0]!.japaneseRomanized).toBe('furontia');
    const json = JSON.stringify(data);
    for (const forbidden of ['tutorMemo', 'PRIVATE', 'technicalExplanation', 'simpleExplanation', 'koreanNative', 'studentId', 'tutorId', 'showDefinition']) expect(json).not.toContain(forbidden);
    expect(data.previousLessonId).toBeNull(); expect(data.nextLessonId).toBe(upcoming);
    expect(data.canRequestMaterial).toBe(false);
    const future = await service.getRecap(upcoming, studentId);
    expect(future.previousLessonId).toBe(past); expect(future.nextLessonId).toBe(next); expect(future.canRequestMaterial).toBe(true);
  });
  test('student ownership and role are enforced for reads and writes', async () => {
    const otherCookie = `studentAuth=${await signAuthToken({ userId: `${fixture}-other`, email: 'other@example.com', role: 'student' })}`;
    for (const cookie of ['', tutorCookie]) {
      expect((await request(`/schedule/lesson-recap/${past}`, undefined, cookie)).status).toBe(401);
      expect((await request(`/schedule/lesson-material-request/${upcoming}`, { courseId: 'daily-dispatch', materialId: article }, cookie)).status).toBe(401);
    }
    expect((await request(`/schedule/lesson-recap/${past}`, undefined, otherCookie)).status).toBe(403);
    expect((await request(`/schedule/lesson-material-request/${upcoming}`, { courseId: 'daily-dispatch', materialId: article }, otherCookie)).status).toBe(403);
    await expect(new StudentService().saveLastViewedLesson(`${fixture}-other`, { sessionId: upcoming, courseId: 'daily-dispatch', lessonId: article, title: 'Fake', lessonNumber: 1, goal: '', viewedAt: Date.now() })).rejects.toThrow();
  });
  test('advance requests use canonical catalog values and reach the matching tutor booking only', async () => {
    for (const [courseId, materialId] of [['conversational-skills', cs], ['business-english', be], ['daily-dispatch', article]] as const) {
      const response = await request(`/schedule/lesson-material-request/${upcoming}`, { courseId, materialId });
      expect(response.status).toBe(200);
      const { data } = await response.json() as { data: { lessonId: string } }; expect(data.lessonId).toBe(materialId);
      const tutorResponse = await request(`/tutor/student/${studentId}/lesson-request?sessionId=${upcoming}`, undefined, tutorCookie);
      expect(tutorResponse.status).toBe(200);
      const tutor = await tutorResponse.json() as { data: { lessonId: string; courseId: string } }; expect(tutor.data.lessonId).toBe(materialId); expect(tutor.data.courseId).toBe(courseId);
      expect((await service.getRecap(next, studentId)).materialRequest).toBeNull();
    }
    expect((await request(`/schedule/lesson-material-request/${upcoming}`, { courseId: 'business-english', materialId: cs })).status).toBe(400);
    for (const materialId of [`${fixture}-draft`, `${fixture}-future`, 'missing']) expect((await request(`/schedule/lesson-material-request/${upcoming}`, { courseId: 'daily-dispatch', materialId })).status).toBe(400);
    expect((await service.getRecap(upcoming, studentId)).materialRequest?.lessonId).toBe(article);
  });
  test('clearing requests cannot resurrect legacy selections and does not erase lesson notes', async () => {
    expect((await request(`/schedule/lesson-material-request/${upcoming}`, { courseId: null })).status).toBe(200);
    expect((await service.getRecap(upcoming, studentId)).materialRequest).toBeNull();
    expect((await new StudentService().getLastViewedLesson(studentId, upcoming)).data).toBeNull();
    expect((await service.getRecap(past, studentId)).materials).toHaveLength(2);
  });
  test('classroom material changes keep request metadata in sync with the catalog', async () => {
    const student = new StudentService();
    await student.saveLastViewedLesson(studentId, { sessionId: upcoming, courseId: 'conversational-skills', lessonId: cs, title: 'Introductions', lessonNumber: 4, goal: '', viewedAt: Date.now() });
    expect((await service.getRecap(upcoming, studentId)).materialRequest?.level).toBe(3);
    expect((await service.getRecap(upcoming, studentId)).materialRequest?.chapter).toBe(2);
    await student.saveLastViewedLesson(studentId, { sessionId: upcoming, courseId: 'daily-dispatch', lessonId: article, title: 'Science article', lessonNumber: 1, goal: '', viewedAt: Date.now() });
    const data = await service.getRecap(upcoming, studentId);
    expect(data.materialRequest?.level).toBeNull(); expect(data.materialRequest?.chapter).toBeNull();
  });
  test('started and cancelled lessons reject advance request changes', async () => {
    expect((await request(`/schedule/lesson-material-request/${past}`, { courseId: 'daily-dispatch', materialId: article })).status).toBe(400);
    const session = getDriver().session();
    try { await session.run('MATCH (booking:Booking {bookingId: $next}) SET booking.status = \'cancelled\'', { next }); }
    finally { await session.close(); }
    expect((await request(`/schedule/lesson-material-request/${next}`, { courseId: 'daily-dispatch', materialId: article })).status).toBe(400);
  });
  test('ongoing reports require three minutes and no tutor entry; after-lesson reports stay available', async () => {
    const session = getDriver().session();
    const startsAt = new Date(Date.now() - 4 * 60000).toISOString();
    const url = `/schedule/lesson/${ongoing}/issue-report`;
    const body = { duration: 'up_to_ten', reason: 'tutor', tutorIssue: 'no_show', details: 'Tutor has not joined.' };
    try {
      await session.run(`MATCH (s:Student {id: $studentId}) CREATE (:Booking {bookingId: $ongoing, tutorId: $tutorId,
        slotDateTime: datetime($startsAt), durationMinutes: 25, status: 'confirmed', testFixture: $fixture})-[:BOOKED_BY]->(s)`, { studentId, ongoing, tutorId, startsAt, fixture });
      const check = async () => (await (await request(url)).json() as { data: { eligible: boolean; reason: string | null } }).data;
      expect((await check()).eligible).toBe(true);
      await session.run('MATCH (b:Booking {bookingId: $ongoing}) SET b.slotDateTime = datetime($startsAt)', { ongoing, startsAt: new Date(Date.now() - 2 * 60000).toISOString() });
      expect((await check()).reason).toBe('waiting_for_tutor');
      expect((await request(url, body, studentCookie, 'POST')).status).toBe(403);
      await session.run('MATCH (b:Booking {bookingId: $ongoing}) SET b.slotDateTime = datetime($startsAt), b.tutorRoomAttendedAt = datetime()', { ongoing, startsAt });
      expect((await check()).reason).toBe('tutor_joined');
      expect((await request(url, body, studentCookie, 'POST')).status).toBe(403);
      await session.run('MATCH (b:Booking {bookingId: $ongoing}) REMOVE b.tutorRoomAttendedAt', { ongoing });
      await new ClassroomActivityService().log({ sessionId: ongoing, userId: tutorId, userType: 'tutor', eventType: 'entered' });
      await new SessionService().addParticipant({ sessionId: ongoing, userId: tutorId, userType: 'tutor', socketId: 'entry-log-fixture-socket' });
      expect((await check()).reason).toBe('tutor_joined');
      expect((await request(url, body, studentCookie, 'POST')).status).toBe(403);
      const activity = new ClassroomActivityService();
      await query("UPDATE classroom_activity_logs SET created_at = NOW() - INTERVAL '120 seconds' WHERE session_id = $1", [ongoing]);
      await query('DELETE FROM session_participants WHERE session_id = $1', [ongoing]);
      const departure = await activity.log({ sessionId: ongoing, userId: tutorId, userType: 'tutor', eventType: 'left' });
      await query("UPDATE classroom_activity_logs SET created_at = NOW() - INTERVAL '59 seconds' WHERE id = $1", [departure.id]);
      expect((await check()).reason).toBe('tutor_disconnected_wait');
      expect((await request(url, { ...body, tutorIssue: 'left_early' }, studentCookie, 'POST')).status).toBe(403);
      await query("UPDATE classroom_activity_logs SET created_at = NOW() - INTERVAL '61 seconds' WHERE id = $1", [departure.id]);
      expect((await check()).eligible).toBe(true);
      expect((await request(url, body, studentCookie, 'POST')).status).toBe(400);
      const participants = new SessionService();
      await participants.addParticipant({ sessionId: ongoing, userId: tutorId, userType: 'tutor', socketId: 'current-fixture-socket' });
      expect((await check()).reason).toBe('tutor_joined');
      expect(await participants.removeParticipant(ongoing, tutorId, 'tutor', 'old-fixture-socket')).toBe(false);
      expect((await check()).reason).toBe('tutor_joined');
      expect(await participants.removeParticipant(ongoing, tutorId, 'tutor', 'current-fixture-socket')).toBe(true);
      expect((await check()).reason).toBe('tutor_disconnected_wait');
      await query('DELETE FROM session_participants WHERE session_id = $1', [ongoing]);
      await activity.log({ sessionId: ongoing, userId: tutorId, userType: 'tutor', eventType: 'entered' });
      await participants.addParticipant({ sessionId: ongoing, userId: tutorId, userType: 'tutor', socketId: 'second-fixture-socket' });
      expect((await check()).reason).toBe('tutor_joined');
      await participants.removeParticipant(ongoing, tutorId, 'tutor', 'second-fixture-socket');
      const secondDeparture = await activity.log({ sessionId: ongoing, userId: tutorId, userType: 'tutor', eventType: 'left' });
      expect((await check()).reason).toBe('tutor_disconnected_wait');
      await query("UPDATE classroom_activity_logs SET created_at = NOW() - INTERVAL '120 seconds' WHERE session_id = $1 AND event_type = 'entered'", [ongoing]);
      await query("UPDATE classroom_activity_logs SET created_at = NOW() - INTERVAL '61 seconds' WHERE id = $1", [secondDeparture.id]);
      await query("UPDATE session_participants SET left_at = NOW() - INTERVAL '61 seconds' WHERE session_id = $1 AND is_active = false", [ongoing]);
      expect((await request(url, { ...body, tutorIssue: 'left_early' }, studentCookie, 'POST')).status).toBe(200);
      const departureReport = await new StudentLessonIssueReportService().get(ongoing, studentId);
      expect(departureReport?.tutorIssue).toBe('left_early');
      expect((await request(url, { ...body, tutorIssue: 'left_early' }, studentCookie, 'POST')).status).toBe(409);
      await query('DELETE FROM student_lesson_issue_reports WHERE booking_id = $1', [ongoing]);
      await query('DELETE FROM classroom_activity_logs WHERE session_id = $1', [ongoing]);
      await query('DELETE FROM session_participants WHERE session_id = $1', [ongoing]);
      expect((await request(url, { ...body, tutorIssue: undefined }, studentCookie, 'POST')).status).toBe(400);
      expect((await request(url, { ...body, tutorIssue: 'late_join' }, studentCookie, 'POST')).status).toBe(400);
      expect((await request(url, body, studentCookie, 'POST')).status).toBe(200);
      const saved = (await (await request(url)).json() as { data: { report: { tutorIssue: string; tutorIssueLabel: string } } }).data.report;
      expect(saved.tutorIssue).toBe('no_show'); expect(saved.tutorIssueLabel).toBe('Tutor did not join the classroom');
      await query('DELETE FROM student_lesson_issue_reports WHERE booking_id = $1', [ongoing]);
      await session.run('MATCH (b:Booking {bookingId: $ongoing}) SET b.slotDateTime = datetime($startsAt), b.tutorRoomAttendedAt = datetime($entry)', {
        ongoing, startsAt: new Date(Date.now() - 26 * 60000).toISOString(), entry: new Date(Date.now() - 20 * 60000).toISOString() });
      expect((await check()).eligible).toBe(true);
      expect((await request(url, { ...body, reason: 'audio', tutorIssue: undefined }, studentCookie, 'POST')).status).toBe(200);
    } finally { await session.close(); }
  });
  test('tutor issue details are validated, persisted, and visible to tutor and admin without attendance changes', async () => {
    const bookingId = `${fixture}-tutor-issue`;
    const session = getDriver().session();
    const reports = new StudentLessonIssueReportService();
    const url = `/schedule/lesson/${bookingId}/issue-report`;
    const body = { duration: 'over_ten', reason: 'tutor', details: '' };
    try {
      await session.run(`MATCH (s:Student {id: $studentId}) CREATE (:Booking {bookingId: $bookingId, tutorId: $tutorId,
        slotDateTime: datetime($start), durationMinutes: 25, status: 'completed', attendanceTutor: 'present', testFixture: $fixture})-[:BOOKED_BY]->(s)`,
        { studentId, tutorId, bookingId, fixture, start: new Date(Date.now() - 3600000).toISOString() });
      for (const tutorIssue of [undefined, 'unknown', 'other']) {
        const response = await request(url, { ...body, tutorIssue }, studentCookie, 'POST');
        expect(response.status).toBe(400);
        expect((await response.json() as { error: string }).error).not.toContain('unexpected');
        expect(await reports.get(bookingId, studentId)).toBeNull();
      }
      expect((await request(url, { ...body, reason: 'audio', tutorIssue: 'late_join' }, studentCookie, 'POST')).status).toBe(400);
      expect((await request(url, { ...body, reason: 'other', details: '   ' }, studentCookie, 'POST')).status).toBe(400);
      const response = await request(url, { ...body, tutorIssue: 'other', details: '  My other tutor issue.  ' }, studentCookie, 'POST');
      expect(response.status).toBe(200);
      const saved = await reports.get(bookingId, studentId);
      expect(saved?.tutorIssue).toBe('other'); expect(saved?.details).toBe('My other tutor issue.');
      expect((await reports.getForTutor(bookingId, tutorId))?.tutorIssueLabel).toBe('Other tutor-related issue');
      expect((await new LessonIssueReviewService().list()).find((report: { id: string; tutorIssueLabel: string | null }) => report.id === saved!.id)?.tutorIssueLabel).toBe('Other tutor-related issue');
      const booking = (await session.run('MATCH (b:Booking {bookingId: $bookingId}) RETURN b', { bookingId })).records[0]!.get('b').properties;
      expect(booking.attendanceTutor).toBe('present'); expect(booking.penaltyCode).toBeUndefined();
      await query('UPDATE student_lesson_issue_reports SET tutor_issue = NULL WHERE booking_id = $1', [bookingId]);
      expect((await reports.getForTutor(bookingId, tutorId))?.tutorIssueLabel).toBeNull();
      expect((await reports.get(bookingId, studentId))?.reason).toBe('tutor');
    } finally { await session.close(); }
  });
  test('student issue reports enforce ownership, time window, persistence and duplicates', async () => {
    const url = `/schedule/lesson/${past}/issue-report`;
    const body = { duration: 'over_ten', reason: 'audio', details: 'The audio stopped during the lesson.' };
    const otherCookie = `studentAuth=${await signAuthToken({ userId: `${fixture}-other`, email: 'other@example.com', role: 'student' })}`;
    for (const cookie of ['', tutorCookie, otherCookie]) {
      const expected = cookie === otherCookie ? 403 : 401;
      expect((await request(url, undefined, cookie)).status).toBe(expected);
      expect((await request(url, body, cookie, 'POST')).status).toBe(expected);
    }
    expect((await request(`/schedule/lesson/${upcoming}/issue-report`, body, studentCookie, 'POST')).status).toBe(403);
    expect((await request(`/schedule/lesson/${next}/issue-report`, body, studentCookie, 'POST')).status).toBe(403);
    const status = await request(url); expect(status.status).toBe(200);
    try {
      const result = await status.json() as { data: { eligible: boolean; report: unknown } };
      expect(result.data.eligible).toBe(true); expect(result.data.report).toBeNull();
      const submissions = await Promise.all([request(url, body, studentCookie, 'POST'), request(url, body, studentCookie, 'POST')]);
      expect(submissions.map(response => response.status).sort()).toEqual([200, 409]);
      const created = submissions.find(response => response.status === 200)!;
      const report = await created.json() as { data: { details: string; reason: string } };
      expect(report.data.details).toBe(body.details); expect(report.data.reason).toBe('audio');
      expect((await request(url, body, studentCookie, 'POST')).status).toBe(409);
      const reloaded = await (await request(url)).json() as { data: { eligible: boolean; report: { details: string } } };
      expect(reloaded.data.eligible).toBe(false); expect(reloaded.data.report.details).toBe(body.details);
      const session = getDriver().session();
      try { await session.run('MATCH (booking:Booking {bookingId: $past}) SET booking.slotDateTime = datetime($start)', { past, start: new Date(Date.now() - 49 * 3600000).toISOString() }); }
      finally { await session.close(); }
      expect((await request(url, body, studentCookie, 'POST')).status).toBe(403);
    } finally { await query('DELETE FROM student_lesson_issue_reports WHERE booking_id = $1', [past]); }
  });
  test('absent lessons never return notes, feedback or assessment, even if stale notes exist', async () => {
    const session = getDriver().session();
    try { await session.run('MATCH (booking:Booking {bookingId: $past}) SET booking.attendanceStudent = \'absent\'', { past }); }
    finally { await session.close(); }
    const data = await service.getRecap(past, studentId);
    expect(data.studentAttendance).toBe('absent'); expect(data.materials).toEqual([]);
    expect(data.studentComment).toBe(''); expect(data.englishLevelAssessment).toBeNull();
  });
});
