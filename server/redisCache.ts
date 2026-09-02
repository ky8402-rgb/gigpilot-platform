import Redis from 'ioredis';

interface MemoryCacheEntry {
  data: any;
  expiresAt: number;
}

// High-performance In-Memory Fallback Cache
const memoryStore = new Map<string, MemoryCacheEntry>();

let redisClient: Redis | null = null;
export let isRedisAvailable = false;
let hasReportedFallback = false;

// Initialize Redis if REDIS_URL environment variable is provided
const redisUrl = process.env.REDIS_URL;

if (redisUrl && redisUrl.trim() !== '') {
  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true,
      enableOfflineQueue: false,
      reconnectOnError: () => false,
      retryStrategy(times) {
        // Do not keep retrying unreachable hosts (e.g. internal cloud DNS)
        if (times >= 1) return null;
        return null;
      },
    });

    // Attach error listener before connecting to prevent unhandled error crashes
    client.on('error', (err: any) => {
      isRedisAvailable = false;
      if (!hasReportedFallback) {
        hasReportedFallback = true;
        console.log(`[Cache] Redis host unreachable (${err.code || err.message}). Active with in-memory TTL cache engine.`);
      }
      try {
        client.disconnect(false);
      } catch {
        // Ignore disconnect errors
      }
      redisClient = null;
    });

    client.on('ready', () => {
      isRedisAvailable = true;
      redisClient = client;
      console.log('[Redis] Connected successfully to Redis server via REDIS_URL');
    });

    client.on('close', () => {
      isRedisAvailable = false;
    });

    client.connect().then(() => {
      if (client.status === 'ready') {
        isRedisAvailable = true;
        redisClient = client;
      }
    }).catch((err: any) => {
      isRedisAvailable = false;
      if (!hasReportedFallback) {
        hasReportedFallback = true;
        console.log(`[Cache] Redis initial connection skipped (${err.code || err.message}). Seamlessly using in-memory cache.`);
      }
      try {
        client.disconnect(false);
      } catch {
        // Ignore disconnect errors
      }
      redisClient = null;
    });
  } catch (err: any) {
    if (!hasReportedFallback) {
      hasReportedFallback = true;
      console.log('[Cache] Redis initialization bypassed, operating with in-memory TTL caching layer.');
    }
  }
} else {
  console.log('[Cache] REDIS_URL not set. Operating with high-speed in-memory TTL caching layer.');
}

/**
 * Retrieve cached JSON object by key
 */
export async function getCache<T = any>(key: string): Promise<T | null> {
  try {
    if (isRedisAvailable && redisClient && redisClient.status === 'ready') {
      const val = await redisClient.get(key);
      if (val) {
        return JSON.parse(val) as T;
      }
    }
  } catch {
    isRedisAvailable = false;
  }

  // Fallback to in-memory store
  const entry = memoryStore.get(key);
  if (entry) {
    if (Date.now() < entry.expiresAt) {
      return entry.data as T;
    }
    memoryStore.delete(key);
  }

  return null;
}

/**
 * Set cache key with time-to-live in seconds (default: 60s)
 */
export async function setCache(key: string, data: any, ttlSeconds: number = 60): Promise<void> {
  try {
    const serialized = JSON.stringify(data);
    if (isRedisAvailable && redisClient && redisClient.status === 'ready') {
      await redisClient.set(key, serialized, 'EX', ttlSeconds);
    }
  } catch {
    isRedisAvailable = false;
  }

  // Always keep in-memory backup
  memoryStore.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Invalidate a specific cache key or prefix
 */
export async function invalidateCache(keyPattern: string): Promise<void> {
  try {
    if (isRedisAvailable && redisClient && redisClient.status === 'ready') {
      if (keyPattern.includes('*')) {
        const keys = await redisClient.keys(keyPattern);
        if (keys.length > 0) {
          await redisClient.del(...keys);
        }
      } else {
        await redisClient.del(keyPattern);
      }
    }
  } catch {
    isRedisAvailable = false;
  }

  // Clear matching in-memory keys
  if (keyPattern.includes('*')) {
    const prefix = keyPattern.replace('*', '');
    for (const k of memoryStore.keys()) {
      if (k.startsWith(prefix)) {
        memoryStore.delete(k);
      }
    }
  } else {
    memoryStore.delete(keyPattern);
  }
}

/**
 * Convenient helper to invalidate all Bids and Dashboard cached records
 */
export async function clearBidsCache(): Promise<void> {
  await invalidateCache('bids:*');
  await invalidateCache('dashboard:*');
  await invalidateCache('api:bids');
  await invalidateCache('api:freelancer:bids');
  await invalidateCache('cache:*');
}

let cacheHits = 0;
let cacheMisses = 0;

export function getCacheStats() {
  const total = cacheHits + cacheMisses;
  const hitRate = total > 0 ? (cacheHits / total) * 100 : 0;
  return {
    isRedisAvailable,
    memoryKeysCount: memoryStore.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: Number(hitRate.toFixed(1))
  };
}

/**
 * Express Middleware for Caching API responses with Redis / In-Memory TTL
 * Automatically intercepts res.json to store the response payload
 */
export function apiCacheMiddleware(ttlSeconds: number = 300) {
  return async (req: any, res: any, next: any) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const key = `cache:${req.originalUrl || req.url}`;
    try {
      const cached = await getCache(key);
      if (cached) {
        cacheHits++;
        res.setHeader('X-Cache-Status', 'HIT');
        res.setHeader('X-Cache-Engine', isRedisAvailable ? 'Redis' : 'Memory-TTL');
        return res.json(cached);
      }
    } catch {
      // Continue to handler on cache lookup failure
    }

    cacheMisses++;
    res.setHeader('X-Cache-Status', 'MISS');

    // Intercept res.json
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      // Only cache successful JSON payloads
      if (res.statusCode >= 200 && res.statusCode < 300 && body) {
        setCache(key, body, ttlSeconds).catch(() => {});
      }
      return originalJson(body);
    };

    next();
  };
}

