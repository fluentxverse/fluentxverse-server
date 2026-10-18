import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { signAuthToken } from '../src/utils/jwt';
import { clearStudentSessionCookies, resolveStudentSession, setStudentSessionCookie } from '../src/utils/studentSession';

const original = {
  NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET,
  API_PUBLIC_URL: process.env.API_PUBLIC_URL, COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
};
const student = { userId: 'student-session-test', email: 'student@example.invalid', role: 'student' };

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'student-session-test-secret-at-least-32-characters';
  process.env.API_PUBLIC_URL = 'https://api.fluentxverse.xyz';
  delete process.env.COOKIE_DOMAIN;
});
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('student cookie migration', () => {
  test('a stale domain cookie cannot shadow a valid student session', async () => {
    const token = await signAuthToken(student);
    const expired = await signAuthToken(student, -60);
    for (const cookie of [
      `studentAuth=${expired}; studentAuth=${token}`,
      `studentAuth=${token}; studentAuth=${expired}`,
      `studentAuth=invalid; studentAuth=${encodeURIComponent(token)}`,
    ]) {
      expect(await resolveStudentSession(new Request('http://localhost', { headers: { cookie } }))).toMatchObject(student);
    }
  });

  test('unsigned, expired, and other-role tokens cannot book lessons', async () => {
    for (const token of ['invalid', await signAuthToken(student, -60), await signAuthToken({ ...student, role: 'tutor' })]) {
      expect(await resolveStudentSession(new Request('http://localhost', { headers: { cookie: `studentAuth=${token}` } }))).toBeNull();
    }
  });

  test('login emits the active host cookie and removes the legacy domain cookie', async () => {
    const token = await signAuthToken(student);
    const app = new Elysia().get('/me', ({ set }) => { setStudentSessionCookie(set, token); return {}; });
    const response = await app.handle(new Request('http://localhost/me'));
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    expect(cookies[0]).toContain(`studentAuth=${token}`);
    expect(cookies[0]).not.toContain('Domain=');
    expect(cookies[0]).toContain('Secure');
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[1]).toContain('Domain=.fluentxverse.xyz');
    expect(cookies[1]).toContain('Max-Age=0');
    expect(cookies[2]).toContain('Domain=.fluentxverse.com');
    expect(cookies[2]).toContain('Max-Age=0');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  test('logout expires all supported student cookie scopes', async () => {
    process.env.COOKIE_DOMAIN = 'api.fluentxverse.xyz';
    const app = new Elysia().post('/logout', ({ set }) => { clearStudentSessionCookies(set); return {}; });
    const response = await app.handle(new Request('http://localhost/logout', { method: 'POST' }));
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(4);
    expect(cookies.every(cookie => cookie.includes('Max-Age=0'))).toBe(true);
    expect(cookies[3]).toContain('Domain=.fluentxverse.com');
  });
});
