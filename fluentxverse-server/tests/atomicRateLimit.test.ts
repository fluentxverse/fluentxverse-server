import { expect, test } from 'bun:test';
import { FixedWindowLimiter, MemoryRateStore, RateLimitUnavailable } from '../src/utils/atomicRateLimit';

test('concurrent fallback calls cannot overrun allowance; expiry does not slide', async () => {
  let now = 1000;
  const store = new MemoryRateStore(10, () => now);
  const results = await Promise.all(Array.from({ length: 100 }, () => store.consume('one', { maxRequests: 10, windowMs: 1000 })));
  expect(results.filter(r => r.allowed)).toHaveLength(10);
  now = 1500; expect((await store.consume('one', { maxRequests: 10, windowMs: 1000 })).ttl).toBe(500);
  now = 2000; expect((await store.consume('one', { maxRequests: 10, windowMs: 1000 })).allowed).toBe(true);
});
test('fallback state is bounded and expired keys are reclaimed', async () => {
  let now = 1000; const store = new MemoryRateStore(1, () => now), policy = { maxRequests: 1, windowMs: 100 };
  await store.consume('a', policy); await expect(store.consume('b', policy)).rejects.toBeInstanceOf(RateLimitUnavailable);
  now = 1100; expect((await store.consume('b', policy)).allowed).toBe(true);
});
test('persistent identities are keyed commitments, never raw users or addresses', async () => {
  let stored = '';
  const limiter = new FixedWindowLimiter({ async consume(key) { stored = key; return { allowed: false, remaining: 0, ttl: 1500 }; } }, 'private-key');
  const result = await limiter.consume('user@example.test:1.2.3.4', 'upload', { maxRequests: 2, windowMs: 1000 });
  expect(stored).not.toContain('example.test'); expect(stored).not.toContain('1.2.3.4'); expect(stored).toMatch(/^fxv:rate:v2:upload:[a-f0-9]{64}$/);
  expect(result.retryAfter).toBe(2);
});
