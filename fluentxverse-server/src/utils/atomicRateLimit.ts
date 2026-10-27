import { RedisClient } from 'bun';
import { createHmac } from 'node:crypto';

export interface RateLimitConfig { windowMs: number; maxRequests: number }
export interface RateLimitResult { allowed: boolean; remaining: number; resetAt: number; retryAfter?: number }
export interface RateStore { consume(key: string, config: RateLimitConfig): Promise<{ allowed: boolean; remaining: number; ttl: number }> }
export class RateLimitUnavailable extends Error { constructor() { super('Request protection is temporarily unavailable.'); } }

// Counter and expiry change atomically. Rejected requests do not extend the window.
export const FIXED_WINDOW_SCRIPT = `
local ttl = redis.call('PTTL', KEYS[1])
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if ttl < 0 then count = 0 end
local maximum = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
if count >= maximum then return {0, 0, math.max(ttl, 1)} end
if ttl < 0 then redis.call('SET', KEYS[1], 1, 'PX', window); count = 1; ttl = window
else count = redis.call('INCR', KEYS[1]) end
return {1, maximum - count, math.max(ttl, 1)}
`;

export class RedisRateStore implements RateStore {
  private client: RedisClient | null = null;
  private connecting: Promise<void> | null = null;
  private unavailableUntil = 0;
  private pending = 0;
  constructor(private url: string) {}
  async consume(key: string, config: RateLimitConfig) {
    if (Date.now() < this.unavailableUntil || this.pending >= 128) throw new RateLimitUnavailable();
    this.pending++;
    try {
      if (!this.client) {
        this.client = new RedisClient(this.url, { connectionTimeout: 1500, enableOfflineQueue: false, autoReconnect: false, maxRetries: 0 });
        this.connecting = this.client.connect().then(() => {});
      }
      await this.connecting;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        this.client.send('EVAL', [FIXED_WINDOW_SCRIPT, '1', key, String(config.maxRequests), String(config.windowMs)]),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RateLimitUnavailable()), 1500); }),
      ]).finally(() => clearTimeout(timer));
      if (!Array.isArray(result) || result.length !== 3) throw new RateLimitUnavailable();
      const [allowed, remaining, ttl] = result.map(Number);
      if (![0, 1].includes(allowed!) || !Number.isSafeInteger(remaining) || remaining! < 0 || !Number.isSafeInteger(ttl) || ttl! < 1) throw new RateLimitUnavailable();
      return { allowed: allowed === 1, remaining: remaining!, ttl: ttl! };
    } catch {
      this.client?.close(); this.client = null; this.connecting = null; this.unavailableUntil = Date.now() + 5000;
      throw new RateLimitUnavailable();
    } finally { this.pending--; }
  }
  close() { this.client?.close(); this.client = null; this.connecting = null; }
}

export class MemoryRateStore implements RateStore {
  private entries = new Map<string, { count: number; resetAt: number }>();
  constructor(private maxKeys = 20000, private now = Date.now) {}
  async consume(key: string, config: RateLimitConfig) {
    const now = this.now();
    let entry = this.entries.get(key);
    if (entry && entry.resetAt <= now) { this.entries.delete(key); entry = undefined; }
    if (!entry) {
      if (this.entries.size >= this.maxKeys) for (const [id, item] of this.entries) if (item.resetAt <= now) this.entries.delete(id);
      if (this.entries.size >= this.maxKeys) throw new RateLimitUnavailable();
      entry = { count: 0, resetAt: now + config.windowMs }; this.entries.set(key, entry);
    }
    const allowed = entry.count < config.maxRequests;
    if (allowed) entry.count++;
    return { allowed, remaining: Math.max(0, config.maxRequests - entry.count), ttl: Math.max(1, entry.resetAt - now) };
  }
}

export class FixedWindowLimiter {
  constructor(private store: RateStore, private secret: string) {}
  async consume(identifier: string, bucket: string, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!Number.isSafeInteger(config.maxRequests) || config.maxRequests < 1 || !Number.isSafeInteger(config.windowMs) || config.windowMs < 1 || !/^[a-zA-Z0-9:_-]{1,80}$/.test(bucket)) throw new RateLimitUnavailable();
    const key = 'fxv:rate:v2:' + bucket + ':' + createHmac('sha256', this.secret).update(identifier).digest('hex');
    const result = await this.store.consume(key, config);
    return { allowed: result.allowed, remaining: result.remaining, resetAt: Date.now() + result.ttl, ...(!result.allowed ? { retryAfter: Math.ceil(result.ttl / 1000) } : {}) };
  }
}

let singleton: FixedWindowLimiter | undefined;
export function requestLimiter() {
  if (!singleton) {
    if (process.env.NODE_ENV === 'production' && (!process.env.REDIS_URL || !process.env.JWT_SECRET)) throw new RateLimitUnavailable();
    singleton = new FixedWindowLimiter(process.env.REDIS_URL ? new RedisRateStore(process.env.REDIS_URL) : new MemoryRateStore(), process.env.JWT_SECRET || 'isolated-development-rate-limiter');
  }
  return singleton;
}
