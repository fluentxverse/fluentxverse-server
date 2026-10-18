import { afterEach, beforeEach, expect, test } from 'bun:test';
import { signAuthToken } from '../src/utils/jwt';
import { authMiddleware } from '../src/socket/middleware/auth.middleware';

const originalSecret = process.env.JWT_SECRET;
beforeEach(() => { process.env.JWT_SECRET = 'socket-auth-regression-test-secret-at-least-32-characters'; });
afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

async function authenticate(cookie = '', token?: string) {
  const socket: any = { handshake: { auth: { token }, headers: { cookie } }, data: {} };
  let error: Error | undefined;
  let calls = 0;
  await authMiddleware(socket, result => { error = result; calls++; });
  expect(calls).toBe(1);
  return { error, data: socket.data };
}

test('student and tutor tokens cannot claim admin privileges through a cookie name', async () => {
  for (const role of ['student', 'tutor']) {
    const token = await signAuthToken({ userId: 'socket-test', email: 'test@example.invalid', role });
    const result = await authenticate(`adminAuth=${token}`);
    expect(result.error).toBeDefined();
    expect(result.data.userType).toBeUndefined();
  }
});

test('all supported signed roles retain their privileges in the proper cookie', async () => {
  for (const [role, cookie] of [['student', 'studentAuth'], ['tutor', 'tutorAuth'], ['admin', 'adminAuth'], ['superadmin', 'adminAuth']]) {
    const token = await signAuthToken({ userId: 'socket-test', email: 'test@example.invalid', role });
    const result = await authenticate(`${cookie}=${token}`);
    expect(result.error).toBeUndefined();
    expect(result.data.userType).toBe(role === 'superadmin' ? 'admin' : role);
  }
});

test('stale cookies do not shadow a matching valid session', async () => {
  const token = await signAuthToken({ userId: 'socket-test', email: 'test@example.invalid', role: 'student' });
  const result = await authenticate(`adminAuth=${token}; studentAuth=expired;studentAuth=${encodeURIComponent(token)}`);
  expect(result.error).toBeUndefined();
  expect(result.data.userType).toBe('student');
});

test('explicit handshake token role is authoritative over cookie names', async () => {
  const token = await signAuthToken({ userId: 'socket-test', email: 'test@example.invalid', role: 'student' });
  const result = await authenticate(`adminAuth=${token}`, token);
  expect(result.error).toBeUndefined();
  expect(result.data.userType).toBe('student');
});

test('unsupported roles and missing identity fields are rejected', async () => {
  for (const payload of [
    { userId: 'socket-test', email: 'test@example.invalid', role: 'unknown' },
    { userId: 'socket-test', email: '', role: 'admin' },
    { userId: '', email: 'test@example.invalid', role: 'admin' },
  ]) {
    const result = await authenticate('', await signAuthToken(payload));
    expect(result.error).toBeDefined();
    expect(result.data.userType).toBeUndefined();
  }
});
