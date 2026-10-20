import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel } from 'kafkajs';
import { describe, expect, it } from 'vitest';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import { metadata, twitterInput, workflow } from './fixtures.js';
import { RedisService } from '../../src/redis/redis.service.js';
import { loadConfig } from '../../src/config/app-config.js';
import { RedisRetryQueue } from '../../src/transformer/retry-queue.js';

// Opt in only against an isolated plaintext test cluster. Never use production brokers.
const brokers = process.env.KAFKA_TEST_BROKERS?.trim();
const redisUrl = process.env.REDIS_TEST_URL;

describe.skipIf(!brokers || !redisUrl)('real Redis/Kafka round trip', () => {
  it('publishes a mapped report and consumes the exact key and JSON value', async () => {
    const client = new Kafka({
      clientId: 'blitz-transformer-test',
      brokers: brokers!.split(',').map((address) => address.trim()),
      logLevel: logLevel.NOTHING,
      connectionTimeout: 3000,
      retry: { retries: 0 },
    });
    const admin = client.admin();
    const consumer = client.consumer({
      groupId: `blitz-transformer-test-${randomUUID()}`,
    });
    const prefix = `blitz:{kafka-test-${randomUUID()}}:outbox`;
    const settings = loadConfig({
      REDIS_URL: redisUrl,
      KAFKA_BROKERS: brokers,
      TRANSFORMER_RETRY_PREFIX: prefix,
    });
    const redis = new RedisService(settings);
    const config = new ConfigService(settings);
    const publisher = new PublishingProcessor(
      config,
      new RedisRetryQueue(redis, config),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await redis.onModuleInit();
      await admin.connect();
      await admin.createTopics({
        topics: [
          { topic: 'reports.raw', numPartitions: 1, replicationFactor: 1 },
        ],
      });
      await consumer.connect();
      await consumer.subscribe({ topic: 'reports.raw', fromBeginning: true });
      const input = twitterInput();
      const marker = `Transformer integration ${randomUUID()}`;
      input.posts[0]!.text = marker;
      input.posts[0]!.url = `https://x.com/blitz/status/1?run=${randomUUID()}`;
      let accept!: (record: { key: string; value: string }) => void;
      const received = new Promise<{ key: string; value: string }>(
        (resolve, reject) => {
          accept = resolve;
          timeout = setTimeout(
            () =>
              reject(new Error('No matching Kafka record within 20 seconds.')),
            20000,
          );
        },
      );
      // Attach a rejection handler before awaiting consumer startup.
      void received.catch(() => undefined);
      await consumer.run({
        eachMessage: async ({ message }) => {
          const value = message.value?.toString();
          if (value && JSON.parse(value).content === marker)
            accept({ key: message.key!.toString(), value });
        },
      });
      const [results, record] = await Promise.all([
        workflow(publisher).run('ProfileScrapeResult', input, {
          ...metadata(),
          inputId: 'integration-test',
        }),
        received,
      ]);
      const report = JSON.parse(record.value);
      expect(record.key).toBe(String(report.report_id));
      expect(results).toEqual([
        {
          status: 'completed',
          inputId: 'integration-test',
          reportId: report.report_id,
        },
      ]);
      expect(report).toMatchObject({
        content: marker,
        platform: 'twitter',
        is_official: false,
        report_url: input.posts[0]!.url,
        languages: ['he'],
        categories: [],
        schema_version: 1,
        matches: ['news'],
      });
    } finally {
      clearTimeout(timeout);
      await Promise.allSettled([
        publisher.onModuleDestroy(),
        consumer.disconnect(),
        admin.disconnect(),
      ]);
      await redis.eval(
        "return redis.call('DEL',unpack(KEYS))",
        [prefix + ':queue', prefix + ':jobs', prefix + ':lease'],
        [],
      );
      await redis.onModuleDestroy();
    }
  }, 60000);
});
