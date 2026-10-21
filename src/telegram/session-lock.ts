import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

/** The Redis operations the lock needs; `RedisService` and the standalone runner's adapter both provide them. */
export interface LockStore {
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}

export const TELEGRAM_SESSION_LOCK_KEY = 'telegram:session-lock';
export const TELEGRAM_SESSION_LOCK_TTL_SECONDS = 120;

// Compare-and-act on the owner token so an instance can never renew or delete a lock that another instance took over.
const RENEW_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) end return 0`;
const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`;

export class SessionLockError extends Error {}

/** Redis lock (SET NX EX) that keeps one Telegram session in one process at a time. */
export class SessionLock {
  /** Identifies this process; stored as the lock value. */
  readonly token = `${hostname()}:${process.pid}:${randomUUID()}`;
  private lastRenewedAt = 0;

  constructor(
    private readonly redis: LockStore,
    private readonly key = TELEGRAM_SESSION_LOCK_KEY,
    private readonly ttlSeconds = TELEGRAM_SESSION_LOCK_TTL_SECONDS,
  ) {}

  /** True when this process now owns the lock. Throws when Redis cannot be reached. */
  async acquire(): Promise<boolean> {
    const ok = await this.redis.setIfAbsent(this.key, this.token, this.ttlSeconds);
    if (ok) this.lastRenewedAt = Date.now();
    return ok;
  }

  /** Current holder (for the error message). */
  holder(): Promise<string | null> {
    return this.redis.get(this.key);
  }

  /**
   * Extends the lock. Returns false once the lock is lost: another instance owns it, or Redis has been
   * unreachable for longer than the TTL so it may already have expired.
   */
  async renew(): Promise<boolean> {
    try {
      const renewed = await this.redis.eval(RENEW_SCRIPT, [this.key], [this.token, String(this.ttlSeconds)]);
      if (Number(renewed) !== 1) return false;
      this.lastRenewedAt = Date.now();
      return true;
    } catch {
      return Date.now() - this.lastRenewedAt < this.ttlSeconds * 1000;
    }
  }

  /** Releases the lock if it is still ours; never throws. */
  async release(): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, [this.key], [this.token]).catch(() => undefined);
  }
}
