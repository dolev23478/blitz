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
  sleepFn?: (ms: number) => Promise<void>;
  onWait?: (seconds: number) => void;
}

/**
 * Runs `fn`; on FLOOD_WAIT waits exactly the requested seconds and retries.
 * Other errors propagate. Never crashes the process on flood errors.
 */
export async function withFloodWait<T>(fn: () => Promise<T>, opts: FloodWaitOptions = {}): Promise<T> {
  const { maxAttempts = 10, sleepFn = sleep, onWait } = opts;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const seconds = floodSeconds(err);
      if (seconds === null || attempt >= maxAttempts) throw err;
      onWait?.(seconds);
      await sleepFn(seconds * 1000);
    }
  }
}
