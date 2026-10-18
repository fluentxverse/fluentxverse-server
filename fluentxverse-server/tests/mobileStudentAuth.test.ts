import { describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import Elysia from 'elysia';
import { MobileAuthService, MobileAuthError, MOBILE_ACCESS_SECONDS, MOBILE_AUDIENCE, MOBILE_ISSUER,
  hashRefreshToken, type MobileAccount, type MobileSession, type MobileSessionStore } from '../src/services/auth.services/mobileAuth.service';
import { createMobileStudentRoutes, mobileStudentFailure } from '../src/routes/mobileStudent.route';

const secret = 'test-mobile-signing-key-that-is-at-least-32-bytes';

class MemoryStore implements MobileSessionStore {
  sessions = new Map<string, MobileSession>();
  tokens = new Map<string, { sessionId: string; used: boolean }>();
  async create(session: MobileSession, hash: string) {
    this.sessions.set(session.id, { ...session });
    this.tokens.set(hash, { sessionId: session.id, used: false });
  }
  async find(id: string) { return this.sessions.get(id) || null; }
  async rotate(hash: string, nextHash: string, now: number) {
    const token = this.tokens.get(hash);
    const session = token && this.sessions.get(token.sessionId);
    if (!token || !session || session.revokedAt !== null || session.expiresAt <= now) return null;
    if (token.used) { session.revokedAt = now; return null; }
    token.used = true;
    this.tokens.set(nextHash, { sessionId: session.id, used: false });
    return { ...session };
  }
  async revoke(id: string, now: number) { const s = this.sessions.get(id); if (s) s.revokedAt = now; }
  async revokeByRefresh(hash: string, now: number) {
    const t = this.tokens.get(hash); if (t) await this.revoke(t.sessionId, now);
  }
}

function fixture() {
  let now = Date.parse('2026-10-14T00:00:00Z');
  const account: MobileAccount = { userId: 'student-1', role: 'student', email: 'student@example.test',
    givenName: 'Alex', familyName: 'Student', signUpdate: now - 1000 };
  let current: MobileAccount | null = account;
  const store = new MemoryStore();
  const auth = new MobileAuthService(store, async id => current?.userId === id ? current : null, secret, () => now);
  const owners: string[] = [];
  const routes = createMobileStudentRoutes({
    auth: () => auth,
    login: async (email, password) => {
      if (email !== account.email || password !== 'correct-password') throw new MobileAuthError(401, 'Invalid email or password.');
      return account;
    },
    profile: async id => { owners.push(id); return { id }; },
    stats: async id => { owners.push(id); return { lessonsCompleted: 1, upcomingLessons: 0, totalHours: 0.4 }; },
    bookings: async id => { owners.push(id); return []; },
    rateLimit: async () => undefined,
  });
  return { auth, store, account, routes, owners, advance: (ms: number) => { now += ms; },
    change: (value: MobileAccount | null) => { current = value; } };
}

const post = (path: string, body: unknown) => new Request(`http://localhost/mobile/student${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('mobile student bearer sessions', () => {
  test('issues short-lived scoped JWTs and stores only refresh hashes', async () => {
    const f = fixture(); const pair = await f.auth.login(f.account);
    expect(pair.tokenType).toBe('Bearer'); expect(pair.expiresIn).toBe(MOBILE_ACCESS_SECONDS);
    expect(pair.refreshToken).toMatch(/^[a-f0-9]{64}$/);
    expect(f.store.tokens.has(pair.refreshToken)).toBe(false);
    expect(f.store.tokens.has(hashRefreshToken(pair.refreshToken))).toBe(true);
    expect(await f.auth.authenticate(`Bearer ${pair.accessToken}`)).toEqual(pair.user);
  });

  test('expired access tokens can rotate refresh tokens', async () => {
    const f = fixture(); const first = await f.auth.login(f.account);
    f.advance((MOBILE_ACCESS_SECONDS + 1) * 1000);
    await expect(f.auth.authenticate(`Bearer ${first.accessToken}`)).rejects.toMatchObject({ status: 401 });
    const second = await f.auth.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(await f.auth.authenticate(`Bearer ${second.accessToken}`)).toEqual(first.user);
  });

  test('reusing a refresh token revokes the entire session family', async () => {
    const f = fixture(); const first = await f.auth.login(f.account);
    const second = await f.auth.refresh(first.refreshToken);
    await expect(f.auth.refresh(first.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(f.auth.refresh(second.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(f.auth.authenticate(`Bearer ${second.accessToken}`)).rejects.toMatchObject({ status: 401 });
  });

  test('simultaneous refresh requests cannot both rotate the same token', async () => {
    const f = fixture(); const pair = await f.auth.login(f.account);
    const results = await Promise.allSettled([f.auth.refresh(pair.refreshToken), f.auth.refresh(pair.refreshToken)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect([...f.store.sessions.values()][0]?.revokedAt).not.toBeNull();
  });

  test('logout immediately revokes both access and refresh tokens', async () => {
    const f = fixture(); const pair = await f.auth.login(f.account);
    await f.auth.logout(pair.refreshToken);
    await expect(f.auth.authenticate(`Bearer ${pair.accessToken}`)).rejects.toMatchObject({ status: 401 });
    await expect(f.auth.refresh(pair.refreshToken)).rejects.toMatchObject({ status: 401 });
    await f.auth.logout(pair.refreshToken);
  });

  test('refresh sessions have a fixed absolute expiry', async () => {
    const f = fixture(); const first = await f.auth.login(f.account);
    f.advance(1000); const second = await f.auth.refresh(first.refreshToken);
    expect(second.refreshExpiresAt).toBe(first.refreshExpiresAt);
    f.advance(31 * 86400000);
    await expect(f.auth.refresh(second.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  test('password changes revoke existing mobile sessions', async () => {
    const f = fixture(); const pair = await f.auth.login(f.account);
    f.change({ ...f.account, signUpdate: Date.parse('2026-10-14T00:00:00Z') + 1 });
    await expect(f.auth.authenticate(`Bearer ${pair.accessToken}`)).rejects.toMatchObject({ status: 401 });
    await expect(f.auth.refresh(pair.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  test('a password change during login cannot keep an old-password session alive', async () => {
    const f = fixture();
    f.change({ ...f.account, signUpdate: Date.parse('2026-10-14T00:00:00Z') - 500 });
    const pair = await f.auth.login(f.account);
    await expect(f.auth.authenticate(`Bearer ${pair.accessToken}`)).rejects.toMatchObject({ status: 401 });
  });

  test('suspension and account deletion prevent mobile access', async () => {
    const f = fixture(); const pair = await f.auth.login(f.account);
    f.change({ ...f.account, suspendedUntil: '2026-11-01T00:00:00Z' });
    await expect(f.auth.authenticate(`Bearer ${pair.accessToken}`)).rejects.toMatchObject({ status: 403 });
    f.change(null);
    await expect(f.auth.refresh(pair.refreshToken)).rejects.toMatchObject({ status: 401 });
  });

  test('a role change permanently revokes the old student session', async () => {
    const f = fixture(); const pair = await f.auth.login(f.account);
    f.change({ ...f.account, role: 'tutor' } as unknown as MobileAccount);
    await expect(f.auth.authenticate(`Bearer ${pair.accessToken}`)).rejects.toMatchObject({ status: 401 });
    f.change(f.account);
    await expect(f.auth.authenticate(`Bearer ${pair.accessToken}`)).rejects.toMatchObject({ status: 401 });
  });

  test('rejects browser JWTs, wrong audiences, tampering, and missing bearer headers', async () => {
    const f = fixture(); const pair = await f.auth.login(f.account);
    const wrong = await new SignJWT({ sid: [...f.store.sessions.keys()][0], role: 'student', purpose: 'mobile_access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' }).setSubject('student-1')
      .setIssuer(MOBILE_ISSUER).setAudience('browser').setIssuedAt().setExpirationTime('15m')
      .sign(new TextEncoder().encode(secret));
    await expect(f.auth.authenticate(`Bearer ${wrong}`)).rejects.toMatchObject({ status: 401 });
    await expect(f.auth.authenticate(`Bearer ${pair.accessToken.slice(0, -8)}aaaaaaaa`)).rejects.toMatchObject({ status: 401 });
    await expect(f.auth.authenticate(null)).rejects.toMatchObject({ status: 401 });
    expect(MOBILE_AUDIENCE).toBe('fluentxverse-student-mobile');
  });

  test('requires a strong dedicated mobile signing key', () => {
    expect(() => new MobileAuthService(new MemoryStore(), async () => null, 'short')).toThrow();
  });
});

describe('mobile student HTTP contract', () => {
  test('the parent server error handler preserves mobile auth status and redacts invalid bodies', async () => {
    const f = fixture();
    const parent = new Elysia().onError(({ error, code, set }) => {
      const response = mobileStudentFailure(error, String(code));
      set.status = response.status;
      return response.body;
    }).use(f.routes);
    const missing = await parent.handle(new Request('http://localhost/mobile/student/me'));
    expect(missing.status).toBe(401);
    const malformed = await parent.handle(post('/auth/refresh', { refreshToken: 'synthetic-secret-token' }));
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).not.toContain('synthetic-secret-token');
  });
  test('native login succeeds without Origin or cookies and emits no cookie', async () => {
    const f = fixture();
    const response = await f.routes.handle(post('/auth/login', { email: 'student@example.test', password: 'correct-password' }));
    expect(response.status).toBe(200); expect(response.headers.has('set-cookie')).toBe(false);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ success: true, tokenType: 'Bearer', user: { role: 'student' } });
  });

  test('invalid credentials and malformed refresh tokens are rejected', async () => {
    const f = fixture();
    expect((await f.routes.handle(post('/auth/login', { email: 'student@example.test', password: 'wrong' }))).status).toBe(401);
    expect((await f.routes.handle(post('/auth/refresh', { refreshToken: 'invalid' }))).status).toBe(400);
  });

  test('account reads use the bearer owner and ignore requested user IDs', async () => {
    const f = fixture(); const pair = await f.auth.login(f.account);
    const response = await f.routes.handle(new Request('http://localhost/mobile/student/profile?userId=someone-else', {
      headers: { Authorization: `Bearer ${pair.accessToken}` },
    }));
    expect(response.status).toBe(200); expect(f.owners).toEqual(['student-1']);
    expect(await response.json()).toEqual({ success: true, data: { id: 'student-1' } });
  });

  test('browser cookies alone never authenticate a mobile request', async () => {
    const f = fixture(); const pair = await f.auth.login(f.account);
    const response = await f.routes.handle(new Request('http://localhost/mobile/student/me', {
      headers: { Cookie: `studentAuth=${pair.accessToken}` },
    }));
    expect(response.status).toBe(401);
  });
});
