import assert from 'node:assert/strict';

if (process.env.LESSON_OUTCOME_TEST !== '1') throw new Error('Use LESSON_OUTCOME_TEST=1 with the disposable outcome databases.');
process.env.DATABASE_URL = 'postgresql://outcome_test:outcome-test-only@127.0.0.1:5547/outcome_test';
process.env.JWT_SECRET = 'outcome-test-only-secret-not-for-production-at-least-32-characters';
process.env.API_PUBLIC_URL = 'http://localhost:8765';
process.env.NODE_ENV = 'test';
const { default: Elysia } = await import('elysia');
const { initDriver, getDriver, closeDriver } = await import('../src/db/memgraph');
const { query, closePool } = await import('../src/db/postgres');
const { signAuthToken } = await import('../src/utils/jwt');
const { adminOperationsRoute } = await import('../src/routes/adminOperations.route');
const { LessonTroubleReportService } = await import('../src/services/lessonTroubleReport.service');
const { StudentLessonIssueReportService } = await import('../src/services/studentLessonIssueReport.service');
const { lessonOutcomeService } = await import('../src/services/lessonOutcome/service');
const { lessonOutcomeRequests } = await import('../src/services/lessonOutcome/requests');
const prefix = `outcome-test-${crypto.randomUUID()}`;
const id = (name: string) => `${prefix}-${name}`;
const start = Date.now() - 72 * 3600_000, end = start + 25 * 60_000;
let checks = 0;
const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const graph = async (text: string, params: Record<string, any> = {}) => {
  const session = getDriver().session();
  try { return await session.run(text, params); } finally { await session.close(); }
};
try {
  await initDriver('bolt://127.0.0.1:7797', '', '', 1);
  const existing = await graph('MATCH(n) RETURN count(n) AS total');
  check(Number(existing.records[0]!.get('total')) === 0, 'Use an empty disposable graph, not existing application data.');
  await query(`CREATE TABLE IF NOT EXISTS session_participants (id BIGSERIAL PRIMARY KEY, session_id TEXT NOT NULL,
    user_id TEXT NOT NULL,user_type TEXT NOT NULL,joined_at TIMESTAMPTZ NOT NULL,last_seen_at TIMESTAMPTZ,left_at TIMESTAMPTZ)`);
  await new LessonTroubleReportService().ensureSchema();
  const reports = new StudentLessonIssueReportService(); await reports.ensureSchema();
  await graph(`CREATE (:User {id:$tutor}),(:Student {id:$student}),
    (:Admin {id:$support,role:'admin',permissions:['support']}),(:Admin {id:$finance,role:'admin',permissions:['finance']})`,
  { tutor: id('tutor'), student: id('student'), support: id('support'), finance: id('finance') });
  for (const name of ['auto', 'reported', 'future', 'penalty-auto']) {
    const startsAt = new Date(name === 'future' ? Date.now() : start).toISOString();
    await graph(`MATCH(s:Student {id:$student}) CREATE (b:Booking {bookingId:$booking,tutorId:$tutor,status:'completed',
      slotDateTime:datetime($startsAt),durationMinutes:25,attendanceTutor:'present',attendanceStudent:'present'})-[:BOOKED_BY]->(s)`,
    { student: id('student'), tutor: id('tutor'), booking: id(name), startsAt });
    for (const role of ['tutor', 'student']) {
      const to = name === 'reported' && role === 'tutor' ? start + 601_000 : end;
      await query('INSERT INTO session_participants(session_id,user_id,user_type,joined_at,last_seen_at,left_at) VALUES($1,$2,$3,$4,$5,$6)',
        [id(name), id(role), role, new Date(start), new Date(to), new Date(to)]);
    }
  }
  await graph("CREATE (:Penalty {bookingId:$booking,tutorId:$tutor,penaltyCode:'301'})",
    { booking: id('penalty-auto'), tutor: id('tutor') });
  const cookies: Record<string, string> = {};
  for (const name of ['support', 'finance', 'tutor', 'student']) {
    const role = ['support', 'finance'].includes(name) ? 'admin' : name;
    cookies[name] = `${role}Auth=${await signAuthToken({ userId: id(name), role, email: `${name}@outcome-test.invalid` })}`;
  }
  const app = new Elysia().use(adminOperationsRoute);
  const request = (path: string, actor = 'support', body?: unknown, origin = 'http://localhost:5175', method = body === undefined ? 'GET' : 'POST') => app.handle(new Request(`http://localhost/admin/operations${path}`, {
    method, headers: { cookie: cookies[actor] || '', 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  for (const actor of ['anonymous', 'student', 'tutor', 'finance']) {
    check((await request(`/lessons/${id('auto')}/outcome`, actor)).status === 403, `${actor} cannot read administrative outcome evidence`);
    check((await request(`/lessons/${id('auto')}/outcome-proof`, actor, {})).status === 403, `${actor} cannot request a proof`);
  }
  check((await request(`/lessons/${id('auto')}/outcome-proof`, 'support', {}, '')).status === 403, 'Mutation needs trusted Origin');
  check((await request(`/lessons/${id('auto')}/outcome-proof`, 'support', {}, 'https://student.fluentxverse.com')).status === 403, 'Student Origin cannot reuse support cookie');
  let response = await request(`/lessons/${id('auto')}/outcome`);
  check(response.headers.get('cache-control')?.includes('no-store'), 'Outcome responses are not cacheable');
  check((await response.json() as any).data.state === 'eligible', 'Unreported completed lesson is eligible');
  const penalized = await lessonOutcomeService.get(id('penalty-auto'));
  check(penalized.state === 'review_required' && penalized.reason === 'ta301_attendance_conflict', 'Legacy TA-301 with no status blocks present attendance');
  check((await request(`/lessons/${id('penalty-auto')}/outcome-proof`, 'support', {})).status === 400, 'Support cannot bypass an uncleared TA-301');
  const premature = await request(`/lessons/${id('future')}/outcome-proof`, 'support', {});
  check(premature.status === 400, `Cannot request before deadline: ${premature.status} ${await premature.text()}`);
  const report = await reports.create(id('reported'), id('student'), 'up_to_ten', 'audio', 'Synthetic audio interruption');
  check(!!report, 'Synthetic report created');
  check((await lessonOutcomeService.get(id('reported'))).state === 'review_required', 'Scenario 4 is held by a student report');
  const review = (body: unknown) => request(`/reports/student/${report!.id}/review`, 'support', body, 'http://localhost:5175', 'PUT');
  check((await review({ status: 'submitted', resolution: 'Checking', completionDecision: 'alternative_approved', completionOutcome: 'early_ended' })).status === 400, 'Unresolved approval rejected');
  check((await review({ status: 'resolved', resolution: 'Reviewed without an explicit outcome' })).status === 200, 'Legacy resolution still works');
  check((await lessonOutcomeService.get(id('reported'))).state === 'review_required', 'Legacy resolved text does not authorize a proof');
  check((await review({ status: 'resolved', resolution: 'Approved early-ended outcome after evidence review', completionDecision: 'alternative_approved', completionOutcome: 'early_ended' })).status === 200, 'Support explicitly approves early-ended outcome');
  check((await lessonOutcomeService.get(id('reported'))).state === 'eligible', 'Support-approved scenario 4 becomes eligible');
  let denied = false;
  try { await lessonOutcomeRequests.request(id('reported'), 'automatic', 'automatic'); } catch { denied = true; }
  check(denied, 'Automatic dispatch never picks up reported lessons');
  response = await request(`/lessons/${id('reported')}/outcome-proof`, 'support', {});
  const queued = (await response.json() as any).data;
  check(response.status === 202 && queued.phase === 'awaiting_prover', 'Support button creates a durable pending request, not a fake proof');
  response = await request(`/lessons/${id('reported')}/outcome-proof`, 'support', {});
  check((await response.json() as any).data.id === queued.id, 'Repeated support requests are idempotent');
  const parallel = await Promise.all(Array.from({ length: 4 }, () => request(`/lessons/${id('reported')}/outcome-proof`, 'support', {})));
  for (const reply of parallel) check(reply.status === 202 && (await reply.json() as any).data.id === queued.id, 'Concurrent requests reuse the existing request');
  await lessonOutcomeRequests.queueUnreported(new Date(start - 1000).toISOString());
  const automatic = await lessonOutcomeService.get(id('auto'));
  check(automatic.proofRequest?.phase === 'awaiting_prover', 'Unreported eligible lesson queues automatically');
  check((await lessonOutcomeService.get(id('penalty-auto'))).proofRequest === null, 'Automatic queue skips a TA-301 lesson');
  check(!automatic.zkVerified && !automatic.generationAvailable, 'Queue never claims cryptographic verification');
  check((await graph('MATCH(r:LessonOutcomeProofRequest) RETURN count(r) AS total')).records[0]!.get('total').toNumber() === 2, 'Only one request per eligible lesson');
  await graph("CREATE (:Penalty {bookingId:$booking,tutorId:$tutor,penaltyCode:'301',status:'active'})",
    { booking: id('auto'), tutor: id('tutor') });
  check((await lessonOutcomeService.get(id('auto'))).proofRequest?.phase === 'needs_reassessment', 'New TA-301 invalidates an existing pending request');
  check((await request(`/lessons/${id('auto')}/outcome-proof`, 'support', {})).status === 400, 'Existing pending request cannot bypass new TA-301');
  await graph("MATCH(p:Penalty {bookingId:$booking,penaltyCode:'301'}) SET p.status='voided'", { booking: id('auto') });
  check((await lessonOutcomeService.get(id('auto'))).state === 'eligible', 'Voided historical TA-301 without revokedAt no longer blocks corrected lesson');
  await graph("MATCH(p:Penalty {bookingId:$booking,penaltyCode:'301'}) SET p.status='active',p.revokedAt=$now", { booking: id('auto'), now: new Date().toISOString() });
  check((await lessonOutcomeService.get(id('auto'))).state === 'eligible', 'Revoked TA-301 no longer blocks even if old status says active');
  await graph("MATCH(b:Booking {bookingId:$booking}) SET b.penaltyCode='301'", { booking: id('auto') });
  check((await lessonOutcomeService.get(id('auto'))).reason === 'ta301_attendance_conflict', 'Stale booking-level TA-301 still requires correction');
  await graph("MATCH(b:Booking {bookingId:$booking}) REMOVE b.penaltyCode", { booking: id('auto') });
  await graph("CREATE (:Penalty {bookingId:$booking,tutorId:$tutor,penaltyCode:'302',status:'active'})", { booking: id('auto'), tutor: id('tutor') });
  check((await lessonOutcomeService.get(id('auto'))).state === 'eligible', 'Other penalty codes and TA-301 on another lesson do not block this lesson');
  const history = await query('SELECT completion_decision,completion_outcome,review_history FROM student_lesson_issue_reports WHERE id=$1', [report!.id]);
  check(history.rows[0].completion_decision === 'alternative_approved' && history.rows[0].review_history.at(-1).completionOutcome === 'early_ended', 'Explicit decision is stored and audited');
  const participantReport = await reports.get(id('reported'), id('student'));
  check(participantReport !== null && !('completionDecision' in participantReport), 'Administrative proof decision is not added to the student API');
  await review({ status: 'under_review', resolution: 'Reopened to check additional evidence' });
  check((await lessonOutcomeService.get(id('reported'))).proofRequest?.phase === 'needs_reassessment', 'Reopened report invalidates queue readiness');
  check((await request(`/lessons/${id('reported')}/outcome-proof`, 'support', {})).status === 400, 'Cannot regenerate during a reopened report');
  await graph("MATCH(b:Booking {bookingId:$id}) SET b.attendanceTutor='absent'", { id: id('auto') });
  check((await lessonOutcomeService.get(id('auto'))).proofRequest?.phase === 'needs_reassessment', 'Attendance correction invalidates queue readiness');
  console.log(`PASS ${checks} isolated database/API outcome checks; no proofs or chain transactions submitted.`);
} finally {
  if (getDriver()) {
    await graph('MATCH(n) WHERE n.bookingId STARTS WITH $prefix OR n.id STARTS WITH $prefix OR n.userId STARTS WITH $prefix DETACH DELETE n', { prefix });
    await closeDriver();
  }
  for (const table of ['session_participants', 'lesson_trouble_reports', 'student_lesson_issue_reports']) {
    await query(`DELETE FROM ${table} WHERE ${table === 'session_participants' ? 'session_id' : 'booking_id'} LIKE $1`, [`${prefix}%`]);
  }
  await closePool();
}
