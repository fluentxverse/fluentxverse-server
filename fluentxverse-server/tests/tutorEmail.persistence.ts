import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import Elysia from 'elysia';
import { initDriver, getDriver, closeDriver } from '../src/db/memgraph';
import { TutorEmailService } from '../src/services/auth.services/tutorEmail.service';
import { EMAIL_CONFIRMATION_TTL, EMAIL_RESEND_COOLDOWN, tutorEmailFailure } from '../src/services/auth.services/tutorEmailPolicy';
import { createTutorEmailRoutes } from '../src/routes/tutorEmail.route';
import { signAuthToken } from '../src/utils/jwt';
import Examination from '../src/routes/exam.route';
import { reserveGeneration } from '../src/services/exam.services/applicationPolicy';

if (process.env.EMAIL_VERIFICATION_TEST_URI !== 'bolt://127.0.0.1:17707') throw Error('Use only the empty dedicated email QA database');
process.env.JWT_SECRET = 'isolated-tutor-email-tests-not-production';
await initDriver(process.env.EMAIL_VERIFICATION_TEST_URI, '', '', 1);
const db = getDriver().session();
let now = Date.now();
const sent: { email: string; token: string }[] = [];
const service = new TutorEmailService(async (email, token) => { sent.push({ email, token }); return 'synthetic-message-id'; }, () => now);
const create = async () => {
  const id = 'email-' + randomUUID(), email = id + '@example.test';
  await db.run('CREATE(:User {id:$id,email:$email,role:\'tutor\',verifiedEmail:false})', { id, email });
  return { id, email };
};
const requestApp = new Elysia({ prefix: '/tutor' }).onError(({ error, code, set }) => { const f=tutorEmailFailure(error,code);set.status=f.status;return f.body; }).use(createTutorEmailRoutes(service));
const req = (path: string, method = 'GET', body?: any, cookie = '', origin = 'https://tutor.fluentxverse.com') => requestApp.handle(new Request('http://localhost/tutor/email-verification' + path, { method, headers: { 'content-type': 'application/json', cookie, origin }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
try {
  assert.equal((await db.run('MATCH(n) RETURN count(n) AS n')).records[0]!.get('n').toNumber(), 0);
  const a = await create(), b = await create();
  const cookie = 'tutorAuth=' + await signAuthToken({ userId: a.id, email: a.email, role: 'tutor' });
  assert.equal((await req('/')).status, 401);
  assert.equal((await req('/send', 'POST', {}, cookie, 'https://evil.test')).status, 403);
  assert.equal((await req('/confirm', 'POST', { token: 'x' })).status, 400);
  const exams = new Elysia().use(Examination);
  for (const path of ['/written/generate', '/speaking/generate']) {
    const r = await exams.handle(new Request('http://localhost/exam' + path, { method: 'POST', headers: { cookie, origin: 'https://tutor.fluentxverse.com' } }));
    assert.equal(r.status, 403); assert.match(await r.text(), /Confirm your email/);
  }
  await assert.rejects(reserveGeneration(a.id, 'written'), /Confirm your email/);
  await service.send(a.id); assert.equal(sent.length, 1);
  const first = sent[0]!.token;
  const raw = (await db.run('MATCH(v:TutorEmailVerification {tutorId:$id}) RETURN v', { id: a.id })).records[0]!.get('v').properties;
  assert.equal(raw.tokenHash, createHash('sha256').update(first).digest('hex'));
  assert(!JSON.stringify(raw).includes(first)); assert(!JSON.stringify(await service.status(a.id)).includes(raw.tokenHash));
  await assert.rejects(service.send(a.id), /wait/);
  await assert.rejects(service.confirm(first, b.id), /another tutor/);
  await assert.rejects(service.confirm(first.slice(0, -1) + (first.endsWith('x') ? 'y' : 'x')), /invalid or expired/);
  now += EMAIL_RESEND_COOLDOWN + 1;
  await service.send(a.id); const second = sent.at(-1)!.token;
  await assert.rejects(service.confirm(first), /invalid or expired/);
  const race = await Promise.allSettled([service.confirm(second), service.confirm(second)]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await service.status(a.id)).verified, true);
  assert.equal((await service.send(a.id)).sent, false);
  await assert.rejects(service.confirm(second), /invalid or expired/);
  const released = await reserveGeneration(a.id, 'written'); assert(released.id);

  await service.send(b.id); const expired = sent.at(-1)!.token;
  now += EMAIL_CONFIRMATION_TTL;
  await assert.rejects(service.confirm(expired), /invalid or expired/);
  await service.send(b.id); const changed = sent.at(-1)!.token;
  await db.run('MATCH(u:User {id:$id}) SET u.email=$email,u.emailAddressVersion=1', { id: b.id, email: 'changed@example.test' });
  await assert.rejects(service.confirm(changed), /invalid or expired/);
  await db.run('MATCH(u:User {id:$id}) SET u.email=$email,u.emailAddressVersion=2', { id: b.id, email: b.email });
  await assert.rejects(service.confirm(changed), /invalid or expired/);
  await db.run('MATCH(u:User {id:$id}) SET u.email=$email', { id: a.id, email: 'new@example.test' });
  assert.equal((await service.status(a.id)).verified, false);
  await assert.rejects(reserveGeneration(a.id, 'written'), /Confirm your email/);

  const c = await create();
  const outcomes = await Promise.allSettled([service.send(c.id), service.send(c.id)]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  for (let i = 0; i < 4; i++) { now += EMAIL_RESEND_COOLDOWN + 1; await service.send(c.id); }
  now += EMAIL_RESEND_COOLDOWN + 1;
  await assert.rejects(service.send(c.id), /limit reached/);
  const d = await create();
  const unknown = new TutorEmailService(async () => { throw Error('SECRET SMTP PASSWORD'); }, () => now);
  await assert.rejects(unknown.send(d.id), /could not confirm email delivery/);
  assert.equal((await unknown.status(d.id)).deliveryStatus, 'unknown');
  const response = await req('/', 'GET', undefined, cookie);
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  console.log('PASS actual Memgraph: hashed tokens, expiry, one-use concurrency, superseded/address-version binding, authenticated resend/cooldown/hour cap, exam HTTP/service gates, unknown SMTP outcome, no secret exposure');
} finally { await db.close(); await closeDriver(); }
