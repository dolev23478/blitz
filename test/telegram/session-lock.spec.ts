import { describe, expect, it } from 'vitest';
import { SessionLock } from '../../src/telegram/session-lock.js';
import type { RedisService } from '../../src/redis/redis.service.js';

/** In-memory stand-in that understands the two compare-and-act scripts of the lock. */
function fakeRedis() {
  const store = new Map<string, string>();
  let down = false;
  const guard = () => {
    if (down) throw new Error('Redis is not connected');
  };
  const redis = {
    async setIfAbsent(key: string, value: string) {
      guard();
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async eval(script: string, keys: string[], args: string[]) {
      guard();
      if (store.get(keys[0]!) !== args[0]) return 0;
      if (script.includes("'del'")) store.delete(keys[0]!);
      return 1;
    },
  };
  return { redis: redis as unknown as RedisService, store, setDown: (v: boolean) => void (down = v) };
}

describe('SessionLock', () => {
  it('lets only one owner acquire, and the second one sees the holder', async () => {
    const { redis } = fakeRedis();
    const a = new SessionLock(redis);
    const b = new SessionLock(redis);
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    expect(await b.holder()).toBe(a.token);
  });

  it('renews only while it still owns the lock', async () => {
    const { redis, store } = fakeRedis();
    const a = new SessionLock(redis);
    await a.acquire();
    expect(await a.renew()).toBe(true);
    store.set('telegram:session-lock', 'someone-else');
    expect(await a.renew()).toBe(false);
  });

  it('keeps the lock through a short Redis outage but gives it up once the TTL has passed', async () => {
    const { redis, setDown } = fakeRedis();
    const a = new SessionLock(redis, 'telegram:session-lock', 1);
    await a.acquire();
    setDown(true);
    expect(await a.renew()).toBe(true);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await a.renew()).toBe(false);
  });

  it('never releases a lock owned by another instance', async () => {
    const { redis, store } = fakeRedis();
    const a = new SessionLock(redis);
    const b = new SessionLock(redis);
    await a.acquire();
    await b.release();
    expect(store.get('telegram:session-lock')).toBe(a.token);
    await a.release();
    expect(store.has('telegram:session-lock')).toBe(false);
  });
});
