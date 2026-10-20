import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RedisService } from '../../src/redis/redis.service.js';
import { loadConfig } from '../../src/config/app-config.js';
import { RedisRetryQueue } from '../../src/transformer/retry-queue.js';
import { ReportValidator } from '../../src/transformer/report-validator.js';
import { rawReport } from './fixtures.js';

// Requires an explicitly supplied, isolated test Redis. These tests execute the real Lua.
const url = process.env.REDIS_TEST_URL;
describe.skipIf(!url)(
  'real Redis retry persistence and atomic leases (Kafka not contacted)',
  () => {
    it('retains exact JSON arrays across client restart, preserves failures, and fences stale completion', async () => {
      const prefix = `blitz:{retry-test-${randomUUID()}}:outbox`;
      const settings = loadConfig({
        REDIS_URL: url,
        TRANSFORMER_RETRY_PREFIX: prefix,
      });
      const config = new ConfigService(settings);
      let redis = new RedisService(settings);
      await redis.onModuleInit();
      try {
        let queue = new RedisRetryQueue(redis, config);
        const value = new ReportValidator(config).serialize(
          rawReport({ languages: [], categories: [] }),
        );
        const [id] = await queue.enqueue([value, value]);
        expect(
          await redis.eval(
            "return redis.call('LLEN',KEYS[1])",
            [prefix + ':queue'],
            [],
          ),
        ).toBe(1);
        const job = (await queue.claim('owner-1'))!;
        expect(job.payload).toBe(value);
        expect(job.report.languages).toEqual([]);
        expect(job.report.categories).toEqual([]);
        expect(
          await new RedisRetryQueue(redis, config).claim('owner-2'),
        ).toBeUndefined();
        await expect(
          queue.finish(job, 'wrong-owner', 'confirmed'),
        ).rejects.toThrow('lease was lost');
        expect(await queue.outcomes([id!])).toEqual(['pending']);
        await queue.retry(
          job,
          'owner-1',
          { at: Date.now(), name: 'Error', message: 'Kafka unavailable' },
          0,
        );
        await queue.release('owner-1');
        await redis.onModuleDestroy();
        redis = new RedisService(settings);
        await redis.onModuleInit();
        queue = new RedisRetryQueue(redis, config);
        const recovered = (await queue.claim('owner-2'))!;
        expect(recovered.attempts).toBe(2);
        expect(recovered.retryCount).toBe(1);
        expect(recovered.errors[0]!.message).toBe('Kafka unavailable');
        expect(recovered.payload).toBe(value);
        await queue.finish(recovered, 'owner-2', 'confirmed');
        await queue.release('owner-2');
        expect(await queue.outcomes([id!])).toEqual(['confirmed']);
        expect(
          await redis.eval(
            "return redis.call('HLEN',KEYS[1])",
            [prefix + ':jobs'],
            [],
          ),
        ).toBe(0);
      } finally {
        await redis.eval(
          "return redis.call('DEL',unpack(KEYS))",
          [prefix + ':queue', prefix + ':jobs', prefix + ':lease'],
          [],
        );
        await redis.onModuleDestroy();
      }
    });
    it('does not claim a failed head before its persisted nextRetryAt', async () => {
      const prefix = `blitz:{retry-test-${randomUUID()}}:outbox`;
      const settings = loadConfig({
        REDIS_URL: url,
        TRANSFORMER_RETRY_PREFIX: prefix,
      });
      const config = new ConfigService(settings);
      const redis = new RedisService(settings);
      await redis.onModuleInit();
      try {
        const queue = new RedisRetryQueue(redis, config);
        await queue.enqueue([
          new ReportValidator(config).serialize(rawReport()),
        ]);
        const job = (await queue.claim('owner-1'))!;
        await queue.retry(
          job,
          'owner-1',
          { at: Date.now(), name: 'Error', message: 'Timeout' },
          60000,
        );
        await queue.release('owner-1');
        expect(await queue.claim('owner-2')).toBeUndefined();
        const saved = await redis.eval(
          "return redis.call('HGET',KEYS[1],ARGV[1])",
          [prefix + ':jobs'],
          [job.id],
        );
        expect(JSON.parse(saved as string).nextRetryAt).toBeGreaterThan(
          Date.now(),
        );
      } finally {
        await redis.eval(
          "return redis.call('DEL',unpack(KEYS))",
          [prefix + ':queue', prefix + ':jobs', prefix + ':lease'],
          [],
        );
        await redis.onModuleDestroy();
      }
    });
  },
);
