import { describe, expect, it, vi, beforeEach } from 'vitest';
import { tl } from '@mtcute/node';
import { parseTargets } from '../../src/tg-realtime/config.js';
import { isTargetChat } from '../../src/tg-realtime/listeners/messageListener.js';
import {
  FloodWaitTooLongError,
  randomDelayMs,
  resetFloodCooldown,
  withFloodWait,
} from '../../src/tg-realtime/utils/resilience.js';

const flood = (s: number) =>
  tl.RpcError.fromTl({ _: 'mt_rpc_error', errorCode: 420, errorMessage: `FLOOD_WAIT_${s}` });

describe('withFloodWait', () => {
  beforeEach(() => resetFloodCooldown());

  it('waits the requested seconds plus jitter, then retries', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValueOnce(flood(7)).mockResolvedValue('ok');
    await expect(withFloodWait(fn, { sleepFn, jitterMs: () => 1500 })).resolves.toBe('ok');
    expect(sleepFn).toHaveBeenCalledWith(8500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never sleeps less than Telegram asked for, with the default jitter', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValueOnce(flood(7)).mockResolvedValue('ok');
    await withFloodWait(fn, { sleepFn });
    const slept = sleepFn.mock.calls[0]![0] as number;
    expect(slept).toBeGreaterThanOrEqual(7500);
    expect(slept).toBeLessThanOrEqual(9000);
  });

  it('refuses to sleep through a long flood wait and blocks further requests until it is over', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValue(flood(3600));
    await expect(withFloodWait(fn, { sleepFn })).rejects.toBeInstanceOf(FloodWaitTooLongError);
    expect(sleepFn).not.toHaveBeenCalled();

    const other = vi.fn().mockResolvedValue('ok');
    await expect(withFloodWait(other, { sleepFn })).rejects.toBeInstanceOf(FloodWaitTooLongError);
    expect(other).not.toHaveBeenCalled(); // the API is not touched during the cooldown
  });

  it('rethrows other errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(withFloodWait(fn, { sleepFn: async () => {} })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('helpers', () => {
  it('randomDelayMs stays within 1.5-3s', () => {
    expect(randomDelayMs(1500, 3000, () => 0)).toBe(1500);
    expect(randomDelayMs(1500, 3000, () => 1)).toBe(3000);
  });

  it('parseTargets mixes usernames and numeric ids', () => {
    expect(parseTargets('@durov, https://t.me/bbcrussian,-1001234567890')).toEqual([
      'durov', 'bbcrussian', -1001234567890,
    ]);
  });

  it('isTargetChat uses the Set', () => {
    const ids = new Set([-100123]);
    expect(isTargetChat(ids, -100123)).toBe(true);
    expect(isTargetChat(ids, 5)).toBe(false);
  });
});
