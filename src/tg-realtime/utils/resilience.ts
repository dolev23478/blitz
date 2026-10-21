import { tl } from '@mtcute/node';

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Random integer delay in [min, max] ms. `rand` is injectable for tests. */
export function randomDelayMs(min: number, max: number, rand: () => number = Math.random): number {
  return Math.round(min + rand() * (max - min));
}

export const sleepRandom = (min: number, max: number): Promise<void> =>
  sleep(randomDelayMs(min, max));

/** Seconds to wait if `err` is a Telegram flood error, otherwise null. */
export function floodSeconds(err: unknown): number | null {
  if (!(err instanceof tl.RpcError)) return null;
  for (const pattern of ['FLOOD_WAIT_%d', 'FLOOD_PREMIUM_WAIT_%d', 'SLOWMODE_WAIT_%d'] as const) {
    if (tl.RpcError.is(err, pattern)) return err.seconds;
  }
  return null;
}

export interface FloodWaitOptions {
  maxAttempts?: number;
  /** Longest flood wait that is slept through; a longer one fails fast with `FloodWaitTooLongError`. */
  maxWaitSeconds?: number;
  sleepFn?: (ms: number) => Promise<void>;
  /** Extra random wait added on top of the seconds Telegram asked for. */
  jitterMs?: () => number;
  onWait?: (seconds: number) => void;
}

/** Telegram asked for a pause longer than we are willing to sleep; callers must stop issuing requests for now. */
export class FloodWaitTooLongError extends Error {
  constructor(readonly seconds: number) {
    super(`FLOOD_WAIT of ${seconds}s exceeds the safe limit; pausing Telegram requests`);
  }
}

// Shared by every caller: once Telegram demanded a long pause, nothing else may hit the API before it is over.
let cooldownUntil = 0;
export const resetFloodCooldown = (): void => {
  cooldownUntil = 0;
};

/**
 * Runs `fn`; on FLOOD_WAIT sleeps the requested seconds plus a random jitter and retries.
 * A wait above `maxWaitSeconds` (default 300) is not slept: it opens a process-wide cooldown and throws
 * `FloodWaitTooLongError`, so workers are never frozen and the API is not retried before the pause ends.
 * Other errors propagate.
 */
export async function withFloodWait<T>(fn: () => Promise<T>, opts: FloodWaitOptions = {}): Promise<T> {
  const { maxAttempts = 10, maxWaitSeconds = 300, sleepFn = sleep, onWait, jitterMs = () => randomDelayMs(500, 2000) } = opts;
  for (let attempt = 1; ; attempt++) {
    const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
    if (remaining > 0) throw new FloodWaitTooLongError(remaining);
    try {
      return await fn();
    } catch (err) {
      const seconds = floodSeconds(err);
      if (seconds === null || attempt >= maxAttempts) throw err;
      if (seconds > maxWaitSeconds) {
        cooldownUntil = Date.now() + seconds * 1000;
        onWait?.(seconds);
        throw new FloodWaitTooLongError(seconds);
      }
      onWait?.(seconds);
      await sleepFn(seconds * 1000 + jitterMs());
    }
  }
}
