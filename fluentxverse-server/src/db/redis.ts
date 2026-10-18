/**
 * Redis-compatible caching utility for Bun
 * Uses in-memory fallback when Redis is unavailable
 */

type CacheStore = Map<string, { value: string; expires: number }>;
type RedisClient = {
  store: CacheStore;
  get(key: string): Promise<string | null>;
  setEx(key: string, ttl: number, value: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
  del(keys: string[]): Promise<void>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  rPush(key: string, value: string): Promise<void>;
  lTrim(key: string, start: number, stop: number): Promise<void>;
};

let redisClient: RedisClient | null = null;
let isConnected = false;

/**
 * Create in-memory Redis-compatible cache client
 */
const createInMemoryCache = (): RedisClient => {
  const store: CacheStore = new Map();

  return {
    store,
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expires) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    async setEx(key: string, ttl: number, value: string) {
      store.set(key, { value, expires: Date.now() + ttl * 1000 });
    },
    async keys(pattern: string) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return Array.from(store.keys()).filter((k) => regex.test(k));
    },
    async del(keys: string[]) {
      keys.forEach((k) => store.delete(k));
    },
    async lRange(key: string, start: number, stop: number) {
      const entry = store.get(key);
      if (!entry) return [];
      try {
        const arr = JSON.parse(entry.value) as unknown[];
        if (!Array.isArray(arr)) return [];
        if (stop === -1) return arr.slice(start).map((v) => JSON.stringify(v));
        return arr.slice(start, stop + 1).map((v) => JSON.stringify(v));
      } catch {
        return [];
      }
    },
    async rPush(key: string, value: string) {
      let entry = store.get(key);
      let arr: unknown[] = [];
      if (entry) {
        try {
          arr = JSON.parse(entry.value) as unknown[];
          if (!Array.isArray(arr)) arr = [];
        } catch {
          arr = [];
        }
      }
      arr.push(JSON.parse(value));
      store.set(key, { value: JSON.stringify(arr), expires: Date.now() + 30 * 24 * 60 * 60 * 1000 });
    },
    async lTrim(key: string, start: number, stop: number) {
      const entry = store.get(key);
      if (!entry) return;
      try {
        let arr = JSON.parse(entry.value) as unknown[];
        if (!Array.isArray(arr)) return;
        if (stop === -1) arr = arr.slice(start);
        else arr = arr.slice(start, stop + 1);
        store.set(key, { value: JSON.stringify(arr), expires: Date.now() + 30 * 24 * 60 * 60 * 1000 });
      } catch {
        // Ignore parse errors
      }
    },
  };
};

/**
 * Initialize Redis-compatible cache
 */
export const initRedis = async () => {
  try {
    redisClient = createInMemoryCache();
    isConnected = true;
  } catch (error) {
    console.warn('⚠️ Cache initialization failed:', error);
    isConnected = false;
  }
};

/**
 * Get Redis client instance
 */
export const getRedis = () => redisClient;

/**
 * Check if Redis is connected
 */
export const isRedisConnected = () => isConnected && redisClient !== null;

/**
 * Cache helper: get or set with TTL
 */
export const cacheGetOrSet = async <T>(key: string, ttlSeconds: number, fetchFn: () => Promise<T>): Promise<T> => {
  if (!isRedisConnected()) {
    return fetchFn();
  }

  try {
    const cached = await redisClient!.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }

    const value = await fetchFn();
    await redisClient!.setEx(key, ttlSeconds, JSON.stringify(value));
    return value;
  } catch (error) {
    console.warn(`Cache error for key ${key}:`, error);
    return fetchFn();
  }
};

/**
 * Invalidate cache by key pattern
 */
export const invalidateCache = async (pattern: string) => {
  if (!isRedisConnected()) return;

  try {
    const keys = await redisClient!.keys(pattern);
    if (keys.length > 0) {
      await redisClient!.del(keys);
    }
  } catch (error) {
    console.warn(`Cache invalidation error for pattern ${pattern}:`, error);
  }
};

/**
 * Cleanup retention: store cleanup history
 */
export const logRetentionCleanup = async (deletedCount: number) => {
  if (!isRedisConnected()) return;

  try {
    const key = 'notifications:cleanup:history';
    const entry = {
      timestamp: new Date().toISOString(),
      deletedCount,
    };
    await redisClient!.rPush(key, JSON.stringify(entry));
    await redisClient!.lTrim(key, -100, -1);
  } catch (error) {
    console.warn('Error logging retention cleanup:', error);
  }
};

/**
 * Get retention cleanup history
 */
export const getRetentionHistory = async () => {
  if (!isRedisConnected()) return [];

  try {
    const key = 'notifications:cleanup:history';
    const entries = await redisClient!.lRange(key, 0, -1);
    return entries.map((e: string) => JSON.parse(e) as { timestamp: string; deletedCount: number });
  } catch (error) {
    console.warn('Error retrieving retention history:', error);
    return [];
  }
};

/**
 * Graceful shutdown
 */
export const closeRedis = async () => {
  if (redisClient) {
    redisClient = null;
    isConnected = false;
  }
};

// ============ Token Blacklist for Session Invalidation ============

/**
 * Add a token to the blacklist (for logout or password change)
 * @param tokenId - Unique identifier for the token (userId + iat timestamp)
 * @param expiresInSeconds - Time until the blacklist entry expires (should match token TTL)
 */
export const blacklistToken = async (tokenId: string, expiresInSeconds: number = 3600): Promise<void> => {
  if (!isRedisConnected()) {
    console.warn('⚠️ Token blacklist unavailable - cache not connected');
    return;
  }

  try {
    const key = `token:blacklist:${tokenId}`;
    await redisClient!.setEx(key, expiresInSeconds, 'revoked');
  } catch (error) {
    console.error('Error blacklisting token:', error);
  }
};

/**
 * Check if a token is blacklisted
 * @param tokenId - Unique identifier for the token
 * @returns true if blacklisted, false otherwise
 */
export const isTokenBlacklisted = async (tokenId: string): Promise<boolean> => {
  if (!isRedisConnected()) {
    return false; // Allow if cache unavailable (fail-open for availability)
  }

  try {
    const key = `token:blacklist:${tokenId}`;
    const result = await redisClient!.get(key);
    return result !== null;
  } catch (error) {
    console.error('Error checking token blacklist:', error);
    return false;
  }
};

/**
 * Invalidate all tokens for a user (e.g., on password change)
 * Uses signUpdate timestamp stored in user record
 * @param userId - User ID to invalidate tokens for
 * @param signUpdate - Timestamp when tokens should be invalidated from
 */
export const invalidateUserTokens = async (userId: string, signUpdate: number): Promise<void> => {
  if (!isRedisConnected()) {
    console.warn('⚠️ Token invalidation unavailable - cache not connected');
    return;
  }

  try {
    const key = `user:signUpdate:${userId}`;
    // Store the signUpdate timestamp - tokens issued before this are invalid
    await redisClient!.setEx(key, 86400, signUpdate.toString()); // 24 hour TTL
  } catch (error) {
    console.error('Error invalidating user tokens:', error);
  }
};

/**
 * Check if a token was issued before user's last signUpdate
 * @param userId - User ID
 * @param tokenIat - Token issued-at timestamp (seconds)
 * @returns true if token is invalid (issued before signUpdate), false otherwise
 */
export const isTokenInvalidatedBySignUpdate = async (userId: string, tokenIat: number): Promise<boolean> => {
  if (!isRedisConnected()) {
    return false;
  }

  try {
    const key = `user:signUpdate:${userId}`;
    const signUpdate = await redisClient!.get(key);
    
    if (!signUpdate) {
      return false; // No signUpdate record, token is valid
    }

    const signUpdateMs = parseInt(signUpdate, 10);
    const tokenIatMs = tokenIat * 1000; // Convert seconds to ms
    
    // Token is invalid if issued before signUpdate
    return tokenIatMs < signUpdateMs;
  } catch (error) {
    console.error('Error checking token signUpdate:', error);
    return false;
  }
};