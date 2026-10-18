import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import Elysia from 'elysia';
import { signAuthToken } from '../src/utils/jwt';
import { clearTutorSessionCookies, resolveTutorSession, setTutorSessionCookie } from '../src/utils/tutorSession';

const original = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
  API_PUBLIC_URL: process.env.API_PUBLIC_URL,
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
};

beforeEach(() => {
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'tutor-session-test-secret-at-least-32-characters';
  process.env.API_PUBLIC_URL = 'https://api.fluentxverse.xyz';
  delete process.env.COOKIE_DOMAIN;
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const tutor = { userId: 'session-test', email: 'tutor@example.com', role: 'tutor' };

describe('tutor session migration', () => {
  test('restores the valid tutor cookie when a stale domain cookie is first', async () => {
    const valid = await signAuthToken(tutor);
    const expired = await signAuthToken(tutor, -60);
    for (const cookie of [
      `tutorAuth=${expired}; tutorAuth=${valid}`,
      `tutorAuth=${valid}; tutorAuth=${expired}`,
      `tutorAuth=invalid; tutorAuth=${encodeURIComponent(valid)}`,
    ]) {
      const request = new Request('https://api.fluentxverse.xyz/tutor/me', { headers: { cookie } });
      expect(await resolveTutorSession(request)).toMatchObject(tutor);
    }
  });

  test('does not restore expired, unsigned, or other-role tokens', async () => {
    const student = await signAuthToken({ ...tutor, role: 'student' });
    const expired = await signAuthToken(tutor, -60);
    for (const token of ['', 'invalid', expired, student]) {
      const request = new Request('https://api.fluentxverse.xyz/tutor/me', {
        headers: { cookie: `tutorAuth=${token}` },
      });
      expect(await resolveTutorSession(request)).toBeNull();
    }
  });

  test('Elysia emits a fresh host cookie and a separate legacy-domain expiry', async () => {
    const token = await signAuthToken(tutor);
    const app = new Elysia().get('/me', ({ set }) => {
      set.headers['Cache-Control'] = 'no-store';
      setTutorSessionCookie(set, token);
      return { success: true };
    });
    const response = await app.handle(new Request('http://localhost/me'));
    const cookies = response.headers.getSetCookie();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(cookies).toHaveLength(3);
    expect(cookies[0]).toContain(`tutorAuth=${token}`);
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('Secure');
    expect(cookies[0]).not.toContain('Domain=');
    expect(cookies[1]).toContain('Domain=.fluentxverse.xyz');
    expect(cookies[1]).toContain('Max-Age=0');
    expect(cookies[2]).toContain('Domain=.fluentxverse.com');
    expect(cookies[2]).toContain('Max-Age=0');
  });

  test('logout expires host-only, legacy, and explicitly configured cookies', async () => {
    process.env.COOKIE_DOMAIN = 'api.fluentxverse.xyz';
    const app = new Elysia().post('/logout', ({ set }) => {
      clearTutorSessionCookies(set);
      return { success: true };
    });
    const response = await app.handle(new Request('http://localhost/logout', { method: 'POST' }));
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(4);
    expect(cookies.every(cookie => cookie.includes('Max-Age=0'))).toBe(true);
    expect(cookies[0]).not.toContain('Domain=');
    expect(cookies[1]).toContain('Domain=api.fluentxverse.xyz');
    expect(cookies[2]).toContain('Domain=.fluentxverse.xyz');
    expect(cookies[3]).toContain('Domain=.fluentxverse.com');
  });
});
