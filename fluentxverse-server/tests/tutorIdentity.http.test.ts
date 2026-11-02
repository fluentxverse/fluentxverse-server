import { test, expect } from 'bun:test';
import Elysia from 'elysia';
import TutorIdentity from '../src/routes/tutorIdentity.route';
import { signAuthToken } from '../src/utils/jwt';
const app = new Elysia().use(TutorIdentity);
test('anonymous applicants and foreign origins cannot read or review IDs', async () => {
  const own = await app.handle(new Request('http://localhost/tutor-identity/status'));
  expect(own.status).toBe(401); expect(own.headers.get('cache-control')).toBe('private, no-store');
  for (const path of ['/admin', '/admin/123/image']) {
    const result = await app.handle(new Request(`http://localhost/tutor-identity${path}`, { headers: { origin: 'https://dashboard.fluentxverse.com' } }));
    expect(result.status).toBe(403);
    expect(await result.text()).not.toContain('ciphertext');
  }
  const review = await app.handle(new Request('http://localhost/tutor-identity/admin/123/review', { method: 'POST',
    headers: { origin: 'https://untrusted.example', 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'fraud', reason: 'test', adultConfirmed: false }) }));
  expect(review.status).toBe(403);
});
test('a student JWT cannot masquerade as an applicant; uploads require tutor origin', async () => {
  const student = await signAuthToken({ userId: 'role-test', email: 'test@example.invalid', role: 'student' });
  expect((await app.handle(new Request('http://localhost/tutor-identity/status', { headers: { cookie: `tutorAuth=${student}` } }))).status).toBe(401);
  const tutor = await signAuthToken({ userId: 'role-test', email: 'test@example.invalid', role: 'tutor' });
  const result = await app.handle(new Request('http://localhost/tutor-identity/submit', { method: 'POST', headers: { cookie: `tutorAuth=${tutor}`, origin: 'https://student.fluentxverse.com' }, body: 'not processed' }));
  expect(result.status).toBe(403);
});
