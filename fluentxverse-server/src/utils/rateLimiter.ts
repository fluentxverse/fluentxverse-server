/**
 * Rate Limiter Utility
 * Uses in-memory cache with sliding window algorithm
 * Compatible with Redis when available
 */

import { getRedis, isRedisConnected } from '../db/redis';

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;       // Unix timestamp when limit resets
  retryAfter?: number;   // Seconds until retry (if blocked)
}

// Maximum allowed pagination limits to prevent DoS
export const MAX_PAGINATION_LIMITS = {
  default: 100,
  search: 50,
  list: 200,
  export: 1000
};

/**
 * Safely parse and cap pagination parameters to prevent DoS attacks
 * @param value - The raw query value (string or undefined)
 * @param defaultVal - Default value if not provided
 * @param maxVal - Maximum allowed value (capped)
 * @returns Safe integer value
 */
export function safePaginationLimit(
  value: string | undefined,
  defaultVal: number = 20,
  maxVal: number = MAX_PAGINATION_LIMITS.default
): number {
  if (!value) return defaultVal;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) return defaultVal;
  return Math.min(parsed, maxVal);
}

/**
 * Safely parse page/offset parameter
 */
export function safePaginationOffset(value: string | undefined, defaultVal: number = 0): number {
  if (!value) return defaultVal;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) return defaultVal;
  return parsed;
}

// Default rate limit configurations
export const RATE_LIMITS = {
  screening: { windowMs: 60 * 1000, maxRequests: 6 },
  // Booking endpoints - strict limits
  booking: { windowMs: 60 * 1000, maxRequests: 5 },      // 5 bookings per minute
  
  // Favorites endpoints - moderate limits
  favorites: { windowMs: 60 * 1000, maxRequests: 30 },   // 30 actions per minute
  
  // Search endpoints - lenient limits
  search: { windowMs: 60 * 1000, maxRequests: 60 },      // 60 searches per minute
  
  // Auth endpoints - strict to prevent brute force
  auth: { windowMs: 15 * 60 * 1000, maxRequests: 10 },   // 10 attempts per 15 minutes

  // OAuth exchanges are already backed by verified provider tokens. Keep their
  // limit separate from password attempts and allow normal session recovery.
  privyAuth: { windowMs: 15 * 60 * 1000, maxRequests: 30 },
  
  // General API - fallback
  general: { windowMs: 60 * 1000, maxRequests: 100 },    // 100 requests per minute
};

// In-memory store for rate limiting (fallback if Redis unavailable)
const memoryStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Check if a request is allowed under rate limits
 * @param identifier - Unique identifier (userId, IP, etc.)
 * @param endpoint - The endpoint category (booking, favorites, etc.)
 * @returns RateLimitResult
 */
export async function checkRateLimit(
  identifier: string,
  endpoint: keyof typeof RATE_LIMITS = 'general'
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[endpoint];
  const key = `ratelimit:${endpoint}:${identifier}`;
  const now = Date.now();
  
  if (isRedisConnected()) {
    return checkRateLimitRedis(key, config, now);
  }
  
  return checkRateLimitMemory(key, config, now);
}

/**
 * Redis-based rate limiting with sliding window
 */
async function checkRateLimitRedis(
  key: string,
  config: RateLimitConfig,
  now: number
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) {
    return checkRateLimitMemory(key, config, now);
  }
  
  try {
    const cached = await redis.get(key);
    const resetAt = now + config.windowMs;
    
    if (!cached) {
      // First request in window
      await redis.setEx(key, Math.ceil(config.windowMs / 1000), JSON.stringify({ count: 1, resetAt }));
      return { allowed: true, remaining: config.maxRequests - 1, resetAt };
    }
    
    const data = JSON.parse(cached) as { count: number; resetAt: number };
    
    if (now > data.resetAt) {
      // Window expired, reset
      await redis.setEx(key, Math.ceil(config.windowMs / 1000), JSON.stringify({ count: 1, resetAt }));
      return { allowed: true, remaining: config.maxRequests - 1, resetAt };
    }
    
    if (data.count >= config.maxRequests) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((data.resetAt - now) / 1000);
      return { 
        allowed: false, 
        remaining: 0, 
        resetAt: data.resetAt,
        retryAfter 
      };
    }
    
    // Increment counter
    data.count++;
    const ttl = Math.ceil((data.resetAt - now) / 1000);
    await redis.setEx(key, ttl, JSON.stringify(data));
    
    return { 
      allowed: true, 
      remaining: config.maxRequests - data.count, 
      resetAt: data.resetAt 
    };
  } catch (error) {
    console.error('Redis rate limit error:', error);
    return checkRateLimitMemory(key, config, now);
  }
}

/**
 * Memory-based rate limiting (fallback)
 */
function checkRateLimitMemory(
  key: string,
  config: RateLimitConfig,
  now: number
): RateLimitResult {
  const resetAt = now + config.windowMs;
  const existing = memoryStore.get(key);
  
  // Clean up expired entries periodically
  if (Math.random() < 0.01) {
    cleanupMemoryStore(now);
  }
  
  if (!existing || now > existing.resetAt) {
    // First request or window expired
    memoryStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt };
  }
  
  if (existing.count >= config.maxRequests) {
    // Rate limit exceeded
    const retryAfter = Math.ceil((existing.resetAt - now) / 1000);
    return { 
      allowed: false, 
      remaining: 0, 
      resetAt: existing.resetAt,
      retryAfter 
    };
  }
  
  // Increment counter
  existing.count++;
  return { 
    allowed: true, 
    remaining: config.maxRequests - existing.count, 
    resetAt: existing.resetAt 
  };
}

/**
 * Clean up expired entries from memory store
 */
function cleanupMemoryStore(now: number): void {
  for (const [key, value] of memoryStore.entries()) {
    if (now > value.resetAt) {
      memoryStore.delete(key);
    }
  }
}

/**
 * Elysia middleware helper for rate limiting
 * Returns an error response if rate limited
 */
export async function rateLimitMiddleware(
  identifier: string,
  endpoint: keyof typeof RATE_LIMITS,
  set: { status: number; headers: Record<string, string> }
): Promise<{ success: false; error: string } | null> {
  const result = await checkRateLimit(identifier, endpoint);
  
  // Set rate limit headers
  set.headers['X-RateLimit-Limit'] = String(RATE_LIMITS[endpoint].maxRequests);
  set.headers['X-RateLimit-Remaining'] = String(result.remaining);
  set.headers['X-RateLimit-Reset'] = String(Math.ceil(result.resetAt / 1000));
  
  if (!result.allowed) {
    set.status = 429;
    set.headers['Retry-After'] = String(result.retryAfter);
    return {
      success: false,
      error: `Rate limit exceeded. Please try again in ${result.retryAfter} seconds.`
    };
  }
  
  return null; // Request allowed
}
