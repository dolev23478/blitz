import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/app-config.js';
import { RedisService } from '../src/redis/redis.service.js';

const client = vi.hoisted(() => ({
  on: vi.fn(),
  connect: vi.fn(),
  quit: vi.fn(),
  set: vi.fn(),
  eval: vi.fn(),
  destroy: vi.fn(),
  isReady: true,
  isOpen: true,
}));
vi.mock('redis', () => ({ createClient: () => client }));

let redis: RedisService;
beforeEach(async () => {
  vi.resetAllMocks();
  client.isReady = true;
  client.isOpen = true;
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  redis = new RedisService(loadConfig({ REDIS_URL: 'redis://localhost:6379' }));
  await redis.onModuleInit();
});
afterEach(async () => {
  await redis.onModuleDestroy();
  vi.restoreAllMocks();
});

describe('Redis write acknowledgment', () => {
  it('resumes queue operations on the same client after an error and reconnection', async () => {
    const onError = client.on.mock.calls.find(
      ([event]) => event === 'error',
    )![1];
    client.isReady = false;
    onError(new Error('Socket closed unexpectedly'));
    expect(redis.isEnabled()).toBe(false);
    client.isReady = true;
    expect(redis.isEnabled()).toBe(true);
    client.eval.mockResolvedValue(1);
    await expect(redis.eval('return 1', ['queue-key'], [])).resolves.toBe(1);
    expect(client.connect).toHaveBeenCalledOnce();
  });

  it('stops a reconnecting client at shutdown instead of leaking its socket', async () => {
    client.isReady = false;
    await redis.onModuleDestroy();
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(client.quit).not.toHaveBeenCalled();
    expect(redis.isEnabled()).toBe(false);
  });

  it('executes atomic retry operations on the existing client connection', async () => {
    client.eval.mockResolvedValue(1);
    await expect(
      redis.eval('return 1', ['queue-key'], ['owner-token']),
    ).resolves.toBe(1);
    expect(client.eval).toHaveBeenCalledWith('return 1', {
      keys: ['queue-key'],
      arguments: ['owner-token'],
    });
    expect(client.connect).toHaveBeenCalledOnce();
  });
  it('returns OK only after the client confirms a write', async () => {
    client.set.mockResolvedValue('OK');
    await expect(redis.set('last-scrape-at', 'timestamp')).resolves.toBe('OK');
    expect(client.set).toHaveBeenCalledWith('last-scrape-at', 'timestamp');
  });

  it.each([null, 'unexpected response'])(
    'rejects an unconfirmed write (%s)',
    async (reply) => {
      client.set.mockResolvedValue(reply);
      await expect(redis.set('last-scrape-at', 'timestamp')).rejects.toThrow(
        'Redis did not confirm the write.',
      );
    },
  );

  it('propagates connection errors rather than reporting a successful write', async () => {
    client.set.mockRejectedValue(new Error('Connection closed'));
    await expect(redis.set('last-scrape-at', 'timestamp')).rejects.toThrow(
      'Connection closed',
    );
  });
});
