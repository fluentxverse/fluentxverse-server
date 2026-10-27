import { requestLimiter } from './atomicRateLimit';
export type { RateLimitConfig, RateLimitResult } from './atomicRateLimit';

export const MAX_PAGINATION_LIMITS = { default: 100, search: 50, list: 200, export: 1000 };
export function safePaginationLimit(value: string | undefined, defaultVal = 20, maxVal = MAX_PAGINATION_LIMITS.default): number {
  if (!value) return defaultVal;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 1 ? defaultVal : Math.min(parsed, maxVal);
}
export function safePaginationOffset(value: string | undefined, defaultVal = 0): number {
  if (!value) return defaultVal;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 0 ? defaultVal : parsed;
}

export const RATE_LIMITS = {
  screening: { windowMs: 60000, maxRequests: 6 },
  booking: { windowMs: 60000, maxRequests: 5 },
  favorites: { windowMs: 60000, maxRequests: 30 },
  search: { windowMs: 60000, maxRequests: 60 },
  auth: { windowMs: 15 * 60000, maxRequests: 10 },
  privyAuth: { windowMs: 15 * 60000, maxRequests: 30 },
  general: { windowMs: 60000, maxRequests: 100 },
} as const;

export async function checkRateLimit(identifier: string, endpoint: keyof typeof RATE_LIMITS = 'general') {
  return requestLimiter().consume(identifier, 'legacy:' + endpoint, RATE_LIMITS[endpoint]);
}

export async function rateLimitMiddleware(identifier: string, endpoint: keyof typeof RATE_LIMITS, set: { status: number; headers: Record<string, string> }) {
  try {
    const result = await checkRateLimit(identifier, endpoint);
    set.headers['X-RateLimit-Limit'] = String(RATE_LIMITS[endpoint].maxRequests);
    set.headers['X-RateLimit-Remaining'] = String(result.remaining);
    set.headers['X-RateLimit-Reset'] = String(Math.ceil(result.resetAt / 1000));
    if (!result.allowed) {
      set.status = 429; set.headers['Retry-After'] = String(result.retryAfter);
      return { success: false, error: `Rate limit exceeded. Please try again in ${result.retryAfter} seconds.` };
    }
    return null;
  } catch {
    set.status = 503; set.headers['Retry-After'] = '5';
    return { success: false, error: 'Request protection is temporarily unavailable. Please retry shortly.' };
  }
}
