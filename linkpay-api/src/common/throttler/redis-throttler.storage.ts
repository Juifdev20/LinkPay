import { Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageService } from '@nestjs/throttler';
import Redis from 'ioredis';

export interface ThrottlerStorageRecord { totalHits: number; timeToExpire: number }

// Atomic fixed window: count the hit, start the window on the first one, report what is left of it.
const HIT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local pttl = redis.call('PTTL', KEYS[1])
if hits == 1 or pttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  pttl = tonumber(ARGV[1])
end
return { hits, pttl }
`;

/**
 * Rate-limit counters shared by every API instance through Redis (REDIS_URL), so a client
 * can't get N times the limit by landing on N instances.
 *
 * If Redis can't be reached the counters fall back to this process's memory: the limit is
 * then per instance (weaker, still a limit) rather than the whole API going down.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly fallback = new ThrottlerStorageService();
  private warnedAt = 0;

  constructor(private readonly redis: Pick<Redis, 'eval' | 'quit'>, private readonly prefix = 'lp:throttle:') {}

  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    try {
      const [hits, pttl] = (await this.redis.eval(HIT_SCRIPT, 1, `${this.prefix}${key}`, String(ttl))) as [number, number];
      return { totalHits: Number(hits), timeToExpire: Math.max(1, Math.ceil(Number(pttl) / 1000)) };
    } catch (err: any) {
      const now = Date.now();
      if (now - this.warnedAt > 60_000) {
        this.warnedAt = now;
        this.logger.error(`Redis unavailable for rate limiting (${err?.message}) — using per-instance counters.`);
      }
      return this.fallback.increment(key, ttl) as any;
    }
  }

  async onApplicationShutdown() {
    this.fallback.onApplicationShutdown();
    await this.redis.quit().catch(() => undefined);
  }
}

/** Redis storage when REDIS_URL is set, otherwise the library's in-memory one (single instance). */
export function createThrottlerStorage(redisUrl: string | undefined): ThrottlerStorage | undefined {
  if (!redisUrl) return undefined;
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false, // fail fast to the in-memory fallback instead of queueing requests
    connectTimeout: 3000,
    lazyConnect: false,
  });
  redis.on('error', () => { /* logged per request by the storage, avoid an unhandled 'error' event */ });
  return new RedisThrottlerStorage(redis);
}
