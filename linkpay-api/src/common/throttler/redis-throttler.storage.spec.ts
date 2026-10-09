import Redis from 'ioredis';
import { RedisThrottlerStorage, createThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage (fallback behaviour, no Redis needed)', () => {
  it('uses the in-memory counters when Redis fails, and keeps counting', async () => {
    const down = { eval: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')), quit: jest.fn().mockResolvedValue('OK') };
    const storage = new RedisThrottlerStorage(down as any);
    expect((await storage.increment('k', 60_000)).totalHits).toBe(1);
    expect((await storage.increment('k', 60_000)).totalHits).toBe(2);
    expect((await storage.increment('other', 60_000)).totalHits).toBe(1);
    await storage.onApplicationShutdown();
  });

  it('maps the script result to the throttler record (hits, seconds left, at least 1)', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([7, 45_100]), quit: jest.fn().mockResolvedValue('OK') };
    const storage = new RedisThrottlerStorage(redis as any, 'p:');
    expect(await storage.increment('ip:login', 60_000)).toEqual({ totalHits: 7, timeToExpire: 46 });
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, 'p:ip:login', '60000');
    redis.eval.mockResolvedValue([1, 10]);
    expect((await storage.increment('x', 60_000)).timeToExpire).toBe(1);
    await storage.onApplicationShutdown();
  });

  it('no REDIS_URL = the library default (memory)', () => {
    expect(createThrottlerStorage(undefined)).toBeUndefined();
    expect(createThrottlerStorage('')).toBeUndefined();
  });
});

// Against a real Redis, when one is available: REDIS_TEST_URL=redis://127.0.0.1:6390 npx jest redis-throttler
const realUrl = process.env.REDIS_TEST_URL;
(realUrl ? describe : describe.skip)('RedisThrottlerStorage against a real Redis', () => {
  let a: RedisThrottlerStorage, b: RedisThrottlerStorage, raw: Redis;
  const prefix = `test:${Date.now()}:`;
  beforeAll(() => {
    raw = new Redis(realUrl!);
    // Two API instances = two storages (two connections) on the same Redis.
    a = new RedisThrottlerStorage(new Redis(realUrl!), prefix);
    b = new RedisThrottlerStorage(new Redis(realUrl!), prefix);
  });
  afterAll(async () => { await a.onApplicationShutdown(); await b.onApplicationShutdown(); await raw.quit(); });

  it('counts hits across instances', async () => {
    expect((await a.increment('ip1', 60_000)).totalHits).toBe(1);
    expect((await b.increment('ip1', 60_000)).totalHits).toBe(2);
    expect((await a.increment('ip1', 60_000)).totalHits).toBe(3);
    expect((await b.increment('ip2', 60_000)).totalHits).toBe(1);
  });

  it('is atomic under concurrency: 200 simultaneous hits from both instances count exactly 200', async () => {
    const results = await Promise.all(Array.from({ length: 200 }, (_, i) => (i % 2 ? a : b).increment('burst', 60_000)));
    expect(Math.max(...results.map((r) => r.totalHits))).toBe(200);
    expect(new Set(results.map((r) => r.totalHits)).size).toBe(200);
  });

  it('the window expires by itself and restarts from 1', async () => {
    expect((await a.increment('short', 300)).totalHits).toBe(1);
    expect((await b.increment('short', 300)).totalHits).toBe(2);
    await new Promise((r) => setTimeout(r, 450));
    expect((await a.increment('short', 300)).totalHits).toBe(1);
  });

  it('always sets an expiry, so a key can never become immortal', async () => {
    await a.increment('ttl-check', 5_000);
    const ttl = await raw.pttl(`${prefix}ttl-check`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5_000);
  });
});
