import { describe, expect, it, vi } from 'vitest';
import { tl } from '@mtcute/node';
import { parseTargets } from '../../src/tg-realtime/config.js';
import { isTargetChat } from '../../src/tg-realtime/listeners/messageListener.js';
import { randomDelayMs, withFloodWait } from '../../src/tg-realtime/utils/resilience.js';

const flood = (s: number) =>
  tl.RpcError.fromTl({ _: 'mt_rpc_error', errorCode: 420, errorMessage: `FLOOD_WAIT_${s}` });

describe('withFloodWait', () => {
  it('waits exactly the requested seconds then retries', async () => {
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const fn = vi.fn().mockRejectedValueOnce(flood(7)).mockResolvedValue('ok');
    await expect(withFloodWait(fn, { sleepFn })).resolves.toBe('ok');
    expect(sleepFn).toHaveBeenCalledWith(7000);
    expect(fn).toHaveBeenCalledTimes(2);
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
