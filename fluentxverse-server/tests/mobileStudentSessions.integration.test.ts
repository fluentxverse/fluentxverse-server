import { beforeAll, afterAll, afterEach, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { randomUUID } from 'node:crypto';
import { PostgresMobileSessionStore } from '../src/services/auth.services/mobileSession.store';
import { hashRefreshToken, type MobileSession } from '../src/services/auth.services/mobileAuth.service';

const testUrl = process.env.MOBILE_AUTH_TEST_DATABASE_URL;
if (testUrl) {
  const url = new URL(testUrl);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/fxv_mobile_auth_test') {
    throw new Error('Mobile auth integration tests require an isolated localhost fxv_mobile_auth_test database.');
  }
}
const suite = testUrl ? describe : describe.skip;

suite('PostgreSQL mobile refresh sessions', () => {
  const sql = new SQL(testUrl || 'postgresql://localhost/fxv_mobile_auth_test');
  const first = new PostgresMobileSessionStore(sql);
  const second = new PostgresMobileSessionStore(sql);
  const now = 1_800_000_000_000;
  const session = (): MobileSession => ({ id: randomUUID(), userId: 'mobile-auth-test',
    createdAt: now, credentialVersion: now - 1000, expiresAt: now + 86400000, revokedAt: null });

  beforeAll(async () => {
    await sql`SELECT 1`;
    await first.find(randomUUID());
    await second.find(randomUUID());
  });
  afterEach(async () => { await sql`DELETE FROM mobile_student_sessions WHERE user_id = ${'mobile-auth-test'}`; });
  afterAll(async () => { await sql.close(); });

  test('session and refresh hashes persist across store instances', async () => {
    const original = session();
    await first.create(original, hashRefreshToken('synthetic-token'));
    expect(await second.find(original.id)).toEqual(original);
    const rows = await sql`SELECT token_hash FROM mobile_student_refresh_tokens WHERE session_id = ${original.id}`;
    expect(rows[0]?.token_hash).toBe(hashRefreshToken('synthetic-token'));
  });

  test('concurrent rotations are serialized and replay revocation is committed', async () => {
    const original = session();
    await first.create(original, hashRefreshToken('first-token'));
    const results = await Promise.all([
      first.rotate(hashRefreshToken('first-token'), hashRefreshToken('next-a'), now + 1),
      second.rotate(hashRefreshToken('first-token'), hashRefreshToken('next-b'), now + 1),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await first.find(original.id))?.revokedAt).toBe(now + 1);
    expect(await first.rotate(hashRefreshToken('next-a'), hashRefreshToken('third'), now + 2)).toBeNull();
    expect(await second.rotate(hashRefreshToken('next-b'), hashRefreshToken('fourth'), now + 2)).toBeNull();
  });

  test('a used refresh token can still revoke its session during logout', async () => {
    const original = session();
    await first.create(original, hashRefreshToken('first-token'));
    expect(await first.rotate(hashRefreshToken('first-token'), hashRefreshToken('next-token'), now + 1)).not.toBeNull();
    await second.revokeByRefresh(hashRefreshToken('first-token'), now + 2);
    expect((await first.find(original.id))?.revokedAt).toBe(now + 2);
  });

  test('expired and unknown refresh tokens cannot rotate', async () => {
    const original = session();
    await first.create(original, hashRefreshToken('expired-token'));
    expect(await first.rotate(hashRefreshToken('expired-token'), hashRefreshToken('next'), original.expiresAt)).toBeNull();
    expect(await first.rotate(hashRefreshToken('unknown-token'), hashRefreshToken('next'), now)).toBeNull();
  });
});
