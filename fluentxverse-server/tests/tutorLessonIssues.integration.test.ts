import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import Tutor from '../src/routes/tutor.route';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { query, closePool } from '../src/db/postgres';
import { signAuthToken } from '../src/utils/jwt';
import { LessonTroubleReportService } from '../src/services/lessonTroubleReport.service';
import { StudentLessonIssueReportService } from '../src/services/studentLessonIssueReport.service';

const enabled = process.env.LESSON_ISSUES_TEST_URI && process.env.LESSON_ISSUES_TEST_DATABASE_URL
  && process.env.DATABASE_URL === process.env.LESSON_ISSUES_TEST_DATABASE_URL;
const suite = enabled ? describe : describe.skip;
const prefix = `issues-test-${crypto.randomUUID()}`;
const tutor = `${prefix}-tutor`, other = `${prefix}-other`, student = `${prefix}-student`, otherStudent = `${prefix}-other-student`;
const app = new Elysia().use(Tutor);
let auth = '', otherAuth = '';
const request = (query = '?period=month&month=2026-10', cookie = auth) => app.handle(new Request(`http://localhost/tutor/lesson-issues${query}`, { headers: { cookie } }));
const graph = async (text: string, params: Record<string, any> = {}) => {
  const session = getDriver().session();
  try { return await session.run(text, params); } finally { await session.close(); }
};

suite('tutor lesson issues API (isolated Memgraph and PostgreSQL)', () => {
  beforeAll(async () => {
    await initDriver(process.env.LESSON_ISSUES_TEST_URI!, '', '', 3, 500);
    await new LessonTroubleReportService().ensureSchema();
    await new StudentLessonIssueReportService().ensureSchema();
    auth = `tutorAuth=${await signAuthToken({ userId: tutor, email: 'issues@test.local', role: 'tutor' })}`;
    otherAuth = `tutorAuth=${await signAuthToken({ userId: other, email: 'other@test.local', role: 'tutor' })}`;
    await graph('CREATE (:Student {id:$student, givenName:"Issue", familyName:"Student"}), (:Student {id:$otherStudent, givenName:"Other"})', { student, otherStudent });
    for (let i = 0; i < 21; i++) {
      const id = `${prefix}-booking-${i}`;
      await graph(`MATCH (s:Student {id:$student}) CREATE (:Booking {bookingId:$id, tutorId:$tutor, slotDateTime:datetime($start)})-[:BOOKED_BY]->(s)`,
        { student, id, tutor, start: i === 0 ? '2026-09-30T16:00:00Z' : '2026-10-07T02:00:00Z' });
      await query(`INSERT INTO lesson_trouble_reports (id,booking_id,tutor_id,duration,reason,student_issue,review_status,resolution,internal_history,review_history,assignee_id)
        VALUES ($1,$2,$3,'up_to_ten','student','late',$4,'Public outcome','["PRIVATE"]','["PRIVATE"]','PRIVATE')`,
        [`${prefix}-sent-${i}`, id, tutor, ['submitted', 'under_review', 'resolved'][i % 3]]);
      if (i < 2) await query(`INSERT INTO student_lesson_issue_reports (id,booking_id,student_id,duration,reason,tutor_issue,details,review_status)
        VALUES ($1,$2,$3,'over_ten','tutor','no_show','Public student description','under_review')`, [`${prefix}-received-${i}`, id, student]);
    }
    for (const [suffix, owner, bookedStudent, start] of [
      ['other-booking', other, otherStudent, '2026-10-07T02:00:00Z'],
      ['outside', tutor, student, '2026-09-30T15:59:59Z'],
      ['wrong-tutor', tutor, student, '2026-10-07T02:00:00Z'],
      ['wrong-student', tutor, student, '2026-10-07T02:00:00Z'],
    ]) {
      await graph(`MATCH (s:Student {id:$student}) CREATE (:Booking {bookingId:$id, tutorId:$owner, slotDateTime:datetime($start)})-[:BOOKED_BY]->(s)`,
        { student: bookedStudent, id: `${prefix}-${suffix}`, owner, start });
    }
    for (const [suffix, owner] of [['other-booking', other], ['outside', tutor], ['wrong-tutor', other]]) {
      await query(`INSERT INTO lesson_trouble_reports (id,booking_id,tutor_id,duration,reason) VALUES ($1,$2,$3,'up_to_ten','audio')`,
        [`${prefix}-report-${suffix}`, `${prefix}-${suffix}`, owner]);
    }
    for (const suffix of ['other-booking', 'wrong-student']) await query(`INSERT INTO student_lesson_issue_reports (id,booking_id,student_id,duration,reason,details)
      VALUES ($1,$2,$3,'up_to_ten','audio','Other student private report')`, [`${prefix}-student-report-${suffix}`, `${prefix}-${suffix}`, otherStudent]);
  });
  afterAll(async () => {
    await query('DELETE FROM lesson_trouble_reports WHERE id LIKE $1', [`${prefix}%`]);
    await query('DELETE FROM student_lesson_issue_reports WHERE id LIKE $1', [`${prefix}%`]);
    await graph('MATCH (n) WHERE n.id STARTS WITH $prefix OR n.bookingId STARTS WITH $prefix DETACH DELETE n', { prefix });
    await closeDriver();
    await closePool();
  });
  test('rejects missing authentication and a valid token with the wrong role', async () => {
    expect((await request('', '')).status).toBe(401);
    const token = await signAuthToken({ userId: tutor, email: 'student@test.local', role: 'student' });
    expect((await request('', `tutorAuth=${token}`)).status).toBe(401);
    for (const suffix of ['?direction=other', '?status=private', '?page=NaN', '?page=0', '?period=other', '?month=2026-99'])
      expect((await request(suffix)).status).toBe(400);
  });
  test('scope comes only from the authenticated tutor and preserves exact pagination', async () => {
    const first = await request('?period=month&month=2026-10&tutorId=' + other);
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    const data = (await first.json() as any).data;
    expect(data.summary).toEqual({ sent: 21, received: 2 });
    expect(data.statusCounts).toEqual({ submitted: 7, under_review: 7, resolved: 7 });
    expect(data.total).toBe(21);
    expect(data.items).toHaveLength(20);
    expect(data.totalPages).toBe(2);
    expect(JSON.stringify(data)).not.toContain('PRIVATE');
    expect(JSON.stringify(data)).not.toContain('wrong-tutor');
    expect(JSON.stringify(data)).not.toContain('other-booking');
    const second = (await (await request('?period=month&month=2026-10&page=2')).json() as any).data;
    expect(second.items).toHaveLength(1);
    expect(new Set([...data.items, ...second.items].map(row => row.id)).size).toBe(21);
    const otherData = (await (await request('?period=all', otherAuth)).json() as any).data;
    expect(otherData.summary.sent).toBe(1);
    expect(otherData.summary.received).toBe(1);
  });
  test('received reports require the booked student and expose public details only', async () => {
    const data = (await (await request('?period=month&month=2026-10&direction=received')).json() as any).data;
    expect(data.total).toBe(2);
    expect(data.items.every((row: any) => row.direction === 'received' && row.studentName === 'Issue Student')).toBe(true);
    expect(data.items[0].issueLabel).toBe('Tutor did not join the classroom');
    expect(data.items[0].details).toBe('Public student description');
    expect(JSON.stringify(data)).not.toContain('Other student private report');
  });
  test('filters statuses without changing direction totals and filters lessons in PHT', async () => {
    const filtered = (await (await request('?period=month&month=2026-10&status=under_review')).json() as any).data;
    expect(filtered.total).toBe(7);
    expect(filtered.summary.sent).toBe(21);
    expect(filtered.items.every((row: any) => row.status === 'under_review')).toBe(true);
    const all = (await (await request('?period=all')).json() as any).data;
    expect(all.summary.sent).toBe(22);
    const empty = (await (await request('?period=month&month=2026-08')).json() as any).data;
    expect(empty.total).toBe(0);
    expect(empty.summary).toEqual({ sent: 0, received: 0 });
    expect(empty.items).toEqual([]);
  });
  test('review changes appear immediately with no cached counts', async () => {
    await query(`UPDATE lesson_trouble_reports SET review_status='resolved' WHERE id=$1`, [`${prefix}-sent-0`]);
    const data = (await (await request('?period=month&month=2026-10&status=resolved')).json() as any).data;
    expect(data.statusCounts.resolved).toBe(8);
    expect(data.statusCounts.submitted).toBe(6);
    expect(data.total).toBe(8);
  });
});
