import assert from 'node:assert/strict';
import Elysia from 'elysia';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { LessonIssueFollowupService } from '../src/services/lessonIssueFollowup.service';
import { EXPLANATION_WINDOW_MS } from '../src/services/lessonIssueFollowup.policy';
import Threads from '../src/routes/lessonIssueThread.route';
import { signAuthToken } from '../src/utils/jwt';
import { payableCompletion } from '../src/services/admin.services/tutorEarnings.service';
import { LessonTroubleReportService } from '../src/services/lessonTroubleReport.service';
import { query, closePool } from '../src/db/postgres';
import { ScheduleService } from '../src/services/schedule.services/schedule.service';
import type { LessonIssueThread } from '../../shared/lessonIssueThread';
if (process.env.ISSUE_TEST_URI !== 'bolt://127.0.0.1:17729') throw Error('Disposable graph on port 17729 required');
process.env.JWT_SECRET = 'synthetic-followup-test-secret';
await initDriver(process.env.ISSUE_TEST_URI, '', '', 40, 1000);
const db = getDriver().session();
let now = Date.parse('2026-10-30T10:00:00Z');
const service = new LessonIssueFollowupService(() => now);
try {
  assert.equal((await db.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n').toNumber(), 0);
  await db.run("CREATE(:User {id:'tutor'}),(:User {id:'other-tutor'}),(:Admin {id:'staff',role:'admin'}),(:Student {id:'student',firstName:'Alice',lastName:'Tanaka',email:'alice@example.test'})");
  const lesson = async (id: string) => {
    await db.run(`MATCH(s:Student {id:'student'}) CREATE(b:Booking {bookingId:$id,tutorId:'tutor',status:'completed',
      slotDateTime:datetime('2026-10-30T10:00:00Z'),durationMinutes:25})-[:BOOKED_BY]->(s)`, { id });
    return await service.open(id, 'tutor', 'report-' + id);
  };
  const tutor = { id: 'tutor', role: 'tutor' as const }, admin = { id: 'admin', role: 'admin' as const };
  const a = await lesson('no-reply');
  const again = await service.open('no-reply', 'tutor', 'different-report-id');
  assert.equal(again.id, a.id); assert.equal(again.deadline, a.deadline);
  await assert.rejects(service.reply(a.id, { ...tutor, id: 'other-tutor' }, 'This is not my lesson.'), /not found/);
  await assert.rejects(service.reply(a.id, tutor, 'Alice Tanaka asked me to cancel.'), /personal information/);
  await service.reply(a.id, admin, 'Please explain what happened during this lesson.');
  assert.equal((await service.list('other-tutor')).length, 0);
  now += EXPLANATION_WINDOW_MS - 1;
  await service.enforceDeadlines();
  assert.equal((await db.run('MATCH(p:Penalty) RETURN count(p) AS n')).records[0]!.get('n').toNumber(), 0);
  now++;
  await assert.rejects(service.reply(a.id, tutor, 'This explanation is too late.'), /deadline/);
  await service.enforceDeadlines(); await service.enforceDeadlines();
  assert.equal((await db.run("MATCH(p:Penalty {bookingId:'no-reply',penaltyCode:'301'}) RETURN count(p) AS n")).records[0]!.get('n').toNumber(), 1);
  const penalizedBooking = (await db.run("MATCH(b:Booking {bookingId:'no-reply'}) RETURN b")).records[0]!.get('b').properties;
  assert.equal(penalizedBooking.penaltyCode, '301');
  assert.throws(() => payableCompletion({ status: 'completed', lessonOutcome: 'attended', attendanceTutor: 'present', attendanceStudent: 'present',
    slotDateTime: '2026-10-30T10:00:00Z', finalizedAt: '2026-10-30T11:00:00Z', penaltyCode: '301' }, now), /not finalized and payable/);
  const timely = await lesson('timely');
  now += EXPLANATION_WINDOW_MS - 1;
  await service.reply(timely.id, tutor, 'The student requested that we reschedule.');
  now += 2; await service.enforceDeadlines();
  assert.equal((await service.list('tutor')).find(t => t.id === timely.id)?.state, 'awaiting_admin');
  const cancelled = await lesson('cancelled');
  await db.run("MATCH(b:Booking {bookingId:'cancelled'}) SET b.status='cancelled'");
  now += EXPLANATION_WINDOW_MS; await service.enforceDeadlines();
  assert.equal((await service.list('tutor')).find(t => t.id === cancelled.id)?.state, 'cancelled');
  const app = new Elysia({ prefix: '/inbox' }).use(Threads);
  assert.equal((await app.handle(new Request('http://localhost/inbox/lesson-issues/'))).status, 401);
  const token = await signAuthToken({ userId: 'other-tutor', email:'other@example.test', role: 'tutor' });
  const response = await app.handle(new Request('http://localhost/inbox/lesson-issues/', { headers: { cookie: 'tutorAuth=' + token } }));
  assert.equal(response.status, 200); assert.equal(((await response.json()) as {data:unknown[]}).data.length, 0);
  const forbidden = await app.handle(new Request('http://localhost/inbox/lesson-issues/' + a.id + '/replies', {
    method: 'POST', headers: { cookie: 'tutorAuth=' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'This is an unauthorized explanation.' }),
  }));
  assert.equal(forbidden.status, 404);
  const race = await lesson('race'); now += EXPLANATION_WINDOW_MS;
  await Promise.allSettled([service.enforceDeadlines(), service.enforceDeadlines(), service.reply(race.id, tutor, 'The explanation arrived at the deadline.')]);
  assert.equal((await db.run("MATCH(p:Penalty {bookingId:'race',penaltyCode:'301'}) RETURN count(p) AS n")).records[0]!.get('n').toNumber(), 1);
  await assert.rejects(service.decide(race.id, 'other-tutor', 'no_penalty', 'Unauthorized waiver request.', 0), /Staff access/);
  await service.decide(race.id, 'staff', 'no_penalty', 'The explanation was verified by staff.', 0);
  await service.enforceDeadlines();
  assert.equal((await service.list('tutor')).find(t => t.id === race.id)?.state, 'no_penalty');
  assert.equal((await db.run("MATCH(p:Penalty {bookingId:'race'}) WHERE p.revokedAt IS NULL RETURN count(p) AS n")).records[0]!.get('n').toNumber(), 0);
  await assert.rejects(service.decide(race.id, 'staff', 'ta301', 'Stale staff decision request.', 0), /Decision changed/);
  const slotId = 'slot-staff-decision';
  await db.run("MATCH(b:Booking {bookingId:'race'}),(u:User {id:'tutor'}) CREATE(u)-[:OPENS_SLOT]->(s:TimeSlot {slotId:$slotId,status:'booked',tutorId:'tutor',slotDate:'2026-10-30',slotTime:'6:00 PM'}) CREATE(b)-[:BOOKS]->(s)", { slotId });
  await service.decide(race.id, 'staff', 'past', 'This lesson slot should be removed.', 1);
  assert.equal((await db.run('MATCH(s:TimeSlot {slotId:$slotId}) RETURN s', { slotId })).records[0]!.get('s').properties.status, 'past');
  const schedule = await new ScheduleService().getTutorSchedule({ tutorId:'tutor',weekOffset:0 });
  const pastSlot = schedule.slots.find(s => s.slotId === slotId)!;
  assert.equal(pastSlot.status,'past'); assert.equal(pastSlot.bookingId,undefined);
  assert.equal((await db.run("MATCH(b:Booking {bookingId:'race'}) RETURN count(b) AS n")).records[0]!.get('n').toNumber(), 1);
  await service.decide(race.id, 'staff', 'ta301', 'Staff confirmed the tutor absence.', 2);
  assert.equal((await db.run("MATCH(b:Booking {bookingId:'race'}) RETURN b")).records[0]!.get('b').properties.penaltyCode, '301');
  assert.equal((await db.run('MATCH(a:LessonIssueDecision {bookingId:"race"}) RETURN count(a) AS n')).records[0]!.get('n').toNumber(), 3);
  // Exercise real decoding, encrypted storage, authenticated multipart upload and image retrieval.
  const { sanitizeIssueImage, LessonIssueImageStorage } = await import('../src/services/lessonIssueImages');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=', 'base64');
  await assert.rejects(sanitizeIssueImage(new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'})), /Images must/);
  await assert.rejects(sanitizeIssueImage(new File(['not png'],'bad.png',{type:'image/png'})), /Invalid image/);
  const normalized = await sanitizeIssueImage(new File([png], 'screen.png', { type:'image/png' }));
  assert.equal(normalized[0],255); assert.equal(normalized[1],216);
  process.env.QA_RECORDING_ENCRYPTION_KEY = 'ab'.repeat(32);
  const stored = new Map<string,Buffer>();
  const filer = Bun.serve({hostname:'127.0.0.1',port:0,fetch:async request=>{
    const path = new URL(request.url).pathname;
    if (request.method==='PUT') { stored.set(path,Buffer.from(await request.arrayBuffer())); return new Response('ok'); }
    if (request.method==='DELETE') { stored.delete(path); return new Response('ok'); }
    return stored.has(path) ? new Response(stored.get(path)) : new Response('',{status:404});
  }});
  process.env.SEAWEED_FILER_URL = `http://127.0.0.1:${filer.port}`;
  try {
    const storage = new LessonIssueImageStorage(), imageId = crypto.randomUUID();
    await storage.put(imageId,normalized); assert.deepEqual(await storage.get(imageId),normalized);
    assert(![...stored.values()][0]!.equals(normalized));
    const ownToken = await signAuthToken({userId:'tutor',email:'tutor@example.test',role:'tutor'});
    const form = new FormData(); form.set('text','The student asked for another topic.'); form.append('images',new File([png],'screen.png',{type:'image/png'}));
    const upload = await app.handle(new Request('http://localhost/inbox/lesson-issues/'+timely.id+'/replies-with-images',{method:'POST',headers:{cookie:'tutorAuth='+ownToken},body:form}));
    assert.equal(upload.status,200,await upload.text());
    const thread = (await service.list('tutor')).find(t=>t.id===timely.id)! as unknown as LessonIssueThread;
    const image = thread.replies.flatMap(r => r.attachments || [])[0]!.id;
    const url = 'http://localhost/inbox/lesson-issues/'+timely.id+'/images/'+image;
    assert.equal((await app.handle(new Request(url,{headers:{cookie:'tutorAuth='+token}}))).status,404);
    assert.equal((await app.handle(new Request(url))).status,401);
    const download = await app.handle(new Request(url,{headers:{cookie:'tutorAuth='+ownToken}}));
    assert.equal(download.status,200); assert.equal(download.headers.get('cache-control'),'private, no-store');
    const staffToken = await signAuthToken({userId:'staff',email:'staff@example.test',role:'admin'});
    assert.equal((await app.handle(new Request(url+'?admin=true',{headers:{cookie:'adminAuth='+staffToken}}))).status,200);
    const decisionResponse = await app.handle(new Request('http://localhost/inbox/lesson-issues/'+race.id+'/decision?admin=true',{
      method:'POST',headers:{cookie:'adminAuth='+staffToken,'Content-Type':'application/json'},
      body:JSON.stringify({decision:'no_penalty',reason:'Staff approved this issue without a penalty.',expectedRevision:3}),
    }));
    assert.equal(decisionResponse.status,200,await decisionResponse.text());
    await db.run("MATCH(a:Admin {id:'staff'}) SET a.role='revoked'");
    assert.equal((await app.handle(new Request(url+'?admin=true',{headers:{cookie:'adminAuth='+staffToken}}))).status,401);
  } finally { filer.stop(true); }
  if (process.env.DATABASE_URL === 'postgresql://postgres:synthetic-test-only@127.0.0.1:17732/issue_followup_test') {
    const reports = new LessonTroubleReportService();
    await reports.ensureSchema();
    for (const id of ['created-report', 'queued-report']) await db.run(`MATCH(s:Student {id:'student'})
      CREATE(:Booking {bookingId:$id,tutorId:'tutor',status:'completed',slotDateTime:datetime('2026-10-30T10:00:00Z'),durationMinutes:25})-[:BOOKED_BY]->(s)`, { id });
    const report = await reports.create('created-report', 'tutor', 'up_to_ten', 'student', 'other');
    assert(report);
    assert.equal(await reports.create('created-report', 'tutor', 'up_to_ten', 'student', 'other'), null);
    await query("INSERT INTO lesson_trouble_reports(id,booking_id,tutor_id,duration,reason,student_issue) VALUES('queued-report-id','queued-report','tutor','over_ten','student','other')");
    await service.dispatch();
    const before = (await service.list('tutor')).find(t => t.bookingId === 'queued-report')!;
    assert(before);
    await query("UPDATE lesson_trouble_reports SET followup_dispatched_at=NULL WHERE booking_id='queued-report'");
    await service.dispatch();
    const after = (await service.list('tutor')).find(t => t.bookingId === 'queued-report')!;
    assert.equal(after.deadline, before.deadline);
    assert.equal((await db.run("MATCH(n:Notification {id:'report:issue-followup:queued-report-id'}) RETURN count(n) AS n")).records[0]!.get('n').toNumber(), 1);
    console.log('PASS: PostgreSQL report creation, duplicate protection, and recoverable exactly-once inbox dispatch');
  }
  console.log('PASS: isolated reply deadlines, privacy, tutor ownership, API auth, cancellation, exactly-once penalties, and timeout races');
} finally { await db.close(); await closeDriver(); await closePool(); }
