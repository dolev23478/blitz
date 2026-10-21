import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Watchdog } from '../../src/tg-realtime/utils/watchdog.js';

function make(probe: () => Promise<unknown>, overrides = {}) {
  const calls = { soft: 0, hard: 0, sync: 0 };
  const wd = new Watchdog({
    probe,
    soft: async () => void calls.soft++,
    hard: async () => void calls.hard++,
    sync: async () => void calls.sync++,
    probeTimeoutMs: 1000,
    softAfter: 2,
    hardAfter: 4,
    syncEveryMs: 0,
    log: () => undefined,
    ...overrides,
  });
  return { wd, calls };
}

describe('Watchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does nothing while the probe succeeds', async () => {
    const { wd, calls } = make(async () => 'ok');
    for (let i = 0; i < 5; i++) await wd.tick();
    expect(calls).toEqual({ soft: 0, hard: 0, sync: 0 });
  });

  it('escalates soft -> hard and syncs once the probe recovers', async () => {
    let healthy = false;
    const { wd, calls } = make(async () => {
      if (!healthy) throw new Error('down');
    });
    for (let i = 0; i < 4; i++) await wd.tick();
    expect(calls.soft).toBe(1);
    expect(calls.hard).toBe(1);
    healthy = true;
    await wd.tick();
    expect(calls.sync).toBe(1);
    await wd.tick();
    expect(calls.sync).toBe(1);
  });

  it('treats a hanging probe as a failure', async () => {
    const { wd, calls } = make(() => new Promise(() => undefined), { softAfter: 1 });
    const t = wd.tick();
    await vi.advanceTimersByTimeAsync(1001);
    await t;
    expect(calls.soft).toBe(1);
  });

  it('runs the heartbeat every tick, even when the probe fails, and survives its errors', async () => {
    let beats = 0;
    const { wd } = make(async () => { throw new Error('down'); }, {
      heartbeat: async () => {
        beats++;
        throw new Error('redis down');
      },
    });
    await wd.tick();
    await wd.tick();
    expect(beats).toBe(2);
  });

  it('runs the periodic safety-net sync even when healthy', async () => {
    const { wd, calls } = make(async () => 'ok', { syncEveryMs: 5000 });
    await wd.tick();
    expect(calls.sync).toBe(0);
    vi.setSystemTime(Date.now() + 6000);
    await wd.tick();
    expect(calls.sync).toBe(1);
  });
});
