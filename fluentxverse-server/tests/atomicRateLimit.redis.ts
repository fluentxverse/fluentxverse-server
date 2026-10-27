import { RedisClient } from 'bun';
import { randomUUID } from 'node:crypto';
import { FixedWindowLimiter, RedisRateStore } from '../src/utils/atomicRateLimit';
import assert from 'node:assert/strict';

if (!process.env.REDIS_URL) throw Error('Set an isolated Redis URL, or explicitly authorize this short-lived namespaced probe.');
const secret = randomUUID(), store = new RedisRateStore(process.env.REDIS_URL), limiter = new FixedWindowLimiter(store, secret);
const direct = new RedisClient(process.env.REDIS_URL), namespace = 'qa:' + randomUUID().replaceAll('-', '');
try {
  const results = await Promise.all(Array.from({ length: 100 }, () => limiter.consume('isolated-test', namespace, { maxRequests: 10, windowMs: 5000 })));
  assert.equal(results.filter(r => r.allowed).length, 10);
  assert(results.filter(r => !r.allowed).every(r => r.retryAfter && r.retryAfter > 0));
  const secondStore = new RedisRateStore(process.env.REDIS_URL), other = new FixedWindowLimiter(secondStore, secret);
  try { assert(!(await other.consume('isolated-test', namespace, { maxRequests: 10, windowMs: 5000 })).allowed); }
  finally { secondStore.close(); }
  const expiryNamespace = 'qa:' + randomUUID().replaceAll('-', '');
  const first = await limiter.consume('expiry', expiryNamespace, { maxRequests: 1, windowMs: 50 });
  assert(first.allowed); assert(!(await limiter.consume('expiry', expiryNamespace, { maxRequests: 1, windowMs: 50 })).allowed);
  await Bun.sleep(80); assert((await limiter.consume('expiry', expiryNamespace, { maxRequests: 1, windowMs: 50 })).allowed);
  const memory = await direct.send('INFO', ['memory']);
  assert(typeof memory === 'string');
  console.log(JSON.stringify({ concurrentAttempts: 100, accepted: 10, rejected: 90, expiryVerified: true, namespaceIsolated: true }));
} finally { store.close(); direct.close(); }
