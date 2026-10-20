import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/app-config.js';
import { RedisService } from '../src/redis/redis.service.js';

const client = vi.hoisted(() => ({
  on: vi.fn(),
  connect: vi.fn(),
  quit: vi.fn(),
  set: vi.fn(),
}));
vi.mock('redis', () => ({ createClient: () => client }));

let redis: RedisService;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  redis = new RedisService(loadConfig({ REDIS_URL: 'redis://localhost:6379' }));
  await redis.onModuleInit();
});
afterEach(async () => {
  await redis.onModuleDestroy();
  vi.restoreAllMocks();
});

describe('Redis write acknowledgment', () => {
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
