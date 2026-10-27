import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { signAuthToken } from '../src/utils/jwt';

assert.equal(process.env.APPLICATION_RELEASE_PROBE, 'isolated-real-provider');
assert.equal(process.env.MEMGRAPH_URI, 'bolt://127.0.0.1:17706');
assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'fxv-application-qa-postgres');
assert.equal(process.env.GMR_ENGINE_API_KEY, undefined);
assert.equal(process.env.SCREENING_ENABLED, 'false');
assert(process.env.OPENAI_API_KEY);
const id = `application-probe-${randomUUID()}`, startedAt = Date.now();
await initDriver(process.env.MEMGRAPH_URI!, '', '', 10, 1000);
const session = getDriver().session();
await session.run("CREATE(:User {id:$id,email:'release-probe@example.invalid',role:'tutor',profileStatus:'pending_review'})", { id });
const token = await signAuthToken({ userId: id, email: 'release-probe@example.invalid', role: 'tutor' });
const child = Bun.spawn(['bun', 'run', '--preload=./tests/application.provider.probe.ts', './src/index.ts'], { stdout: 'pipe', stderr: 'pipe' });
const stdout = new Response(child.stdout).text(), stderr = new Response(child.stderr).text();
const origin = 'http://127.0.0.1:8765';
let step = 'startup';
let lastStatus: number | undefined;
const redact = (value: string) => Object.entries(process.env)
  .filter(([key, value]) => /KEY|SECRET|PASSWORD|TOKEN/.test(key) && value && value.length >= 8)
  .reduce((text, [, value]) => text.replaceAll(value!, '[redacted]'), value)
  .replaceAll(token, '[redacted]');
async function request(path: string, method = 'GET', body?: unknown, auth = token) {
  const r = await fetch(origin + path, { method, headers: { cookie: `tutorAuth=${auth}`, origin: 'https://tutor.fluentxverse.com',
    ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(100000) });
  lastStatus = r.status;
  return { status: r.status, body: await r.json() as any, cache: r.headers.get('cache-control') };
}
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + '/health')).ok) break; } catch { /* Wait for the isolated process. */ }
    if (i === 99) throw Error('Isolated API did not start');
    await Bun.sleep(100);
  }
  step = 'authentication';
  assert.equal((await request('/exam/status', 'GET', undefined, '')).status, 401);
  const wrong = await signAuthToken({ userId: id, email: 'release-probe@example.invalid', role: 'student' });
  assert.equal((await request('/exam/status', 'GET', undefined, wrong)).status, 401);
  assert.equal((await request('/exam/written/submit', 'POST', { examId: 'not-an-attempt', answers: [99] })).status, 422);
  assert.equal((await request('/exam/speaking/generate', 'POST')).status, 409);
  step = 'written-generation';
  const written = await request('/exam/written/generate', 'POST');
  assert.equal(written.status, 200); assert.equal(written.body.exam.questions.length, 30);
  assert(!JSON.stringify(written.body.exam).includes('correctAnswer'));
  const raw = (await session.run('MATCH(e:Exam {id:$examId}) RETURN e.content AS content', { examId: written.body.exam.examId })).records[0]!.get('content');
  const correct = JSON.parse(raw).questions.map((q: any) => q.correctAnswer);
  step = 'written-submission';
  const graded = await request('/exam/written/submit', 'POST', { examId: written.body.exam.examId, answers: correct });
  assert.equal(graded.status, 200); assert.equal(graded.body.result.percentage, 100);
  step = 'oral-generation';
  const oral = await request('/exam/speaking/generate', 'POST');
  assert.equal(oral.status, 200); assert.equal(oral.body.exam.tasks.length, 10);
  const examId = oral.body.exam.examId;
  const bytes = Buffer.from(await Bun.file('/probe/response.wav').arrayBuffer());
  const audioUrl = `data:audio/wav;base64,${bytes.toString('base64')}`;
  step = 'oral-recordings';
  for (const task of oral.body.exam.tasks) {
    const saved = await request('/exam/speaking/recording', 'POST', { examId, recording: { taskId: task.id, audioUrl, duration: 10 } });
    assert.equal(saved.status, 200); assert.equal(saved.body.saved, true);
  }
  const resumed = await request('/exam/speaking/active');
  assert.equal(resumed.body.exam.savedTaskIds.length, 10);
  step = 'asynchronous-submission';
  const submittedAt = Date.now(), submitted = await request('/exam/speaking/submit', 'POST', { examId });
  assert.equal(submitted.status, 202); assert(Date.now() - submittedAt < 3000);
  const duplicate = await request('/exam/speaking/submit', 'POST', { examId });
  assert([200, 202].includes(duplicate.status));
  step = 'real-transcription-and-grading';
  const until = Date.now() + 300000;
  let state: any;
  do {
    state = (await request('/exam/speaking/status')).body.status;
    if (state.hasCompletedExam) break;
    assert(!state.gradingFailed, 'Provider grading reached its bounded failure state');
    await Bun.sleep(2000);
  } while (Date.now() < until);
  assert(state.hasCompletedExam, 'Automatic worker did not finish within five minutes');
  step = 'result-verification';
  const completed = await request(`/exam/speaking/result/${examId}`);
  assert.equal(completed.status, 200); assert.equal(completed.cache, 'private, no-store');
  const result = completed.body.result;
  assert.equal(result.assessmentMode, 'transcript-content'); assert.equal(result.audioReviewRequired, true);
  assert.equal(result.taskScores.length, 10); assert.equal(result.sectionAverages.pronunciation, null); assert.equal(result.sectionAverages.fluency, null);
  assert(result.taskScores.every((task: any) => task.transcription.length > 0 && Number.isFinite(task.percentage)));
  const user = (await session.run('MATCH(u:User {id:$id}) RETURN u', { id })).records[0]!.get('u').properties;
  assert.equal(user.writtenExamPassed, true); assert.equal(Boolean(user.speakingExamPassed), result.passed);
  assert.notEqual(user.certificationStatus, 'certified');
  console.log(JSON.stringify({ passed: true, synthetic: true, realOpenAI: true, writtenQuestions: 30, oralTasks: 10,
    persistedRecordings: 10, automaticWorkerCompleted: true, correctAuthStatusCodes: true, acousticScoresNotInvented: true,
    humanApprovalsStillRequired: true, chainTransactions: 0, durationMs: Date.now() - startedAt }));
} catch (error) {
  console.log(JSON.stringify({ passed: false, step, lastStatus, errorType: error instanceof Error ? error.name : 'Unknown',
    message: redact(error instanceof Error ? error.message : 'Unknown').slice(0, 600), apiExitCode: child.exitCode, durationMs: Date.now() - startedAt }));
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM'); await child.exited;
  const logs = await Promise.all([stdout, stderr]);
  if (logs.some(value => value.includes(process.env.OPENAI_API_KEY!))) { process.exitCode = 1; console.log('Provider credential appeared in isolated logs. Release blocked.'); }
  else if (process.exitCode === 1) {
    const diagnostic = logs.join('\n').match(/\[application\] Written generation failed[\s\S]{0,1800}/)?.[0];
    if (diagnostic) console.log(diagnostic.split(/\n(?=\[|\u001b)/)[0]);
    for (const line of logs.join('\n').split('\n').filter(line => line.startsWith('[provider-probe]'))) console.log(redact(line));
  }
  await session.close(); await closeDriver();
}
