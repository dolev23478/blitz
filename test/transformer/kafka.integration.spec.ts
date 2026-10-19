import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel } from 'kafkajs';
import { describe, expect, it } from 'vitest';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import { metadata, twitterInput, workflow } from './fixtures.js';

// Opt in only against an isolated plaintext test cluster. Never use production brokers.
const brokers = process.env.KAFKA_TEST_BROKERS?.trim();

describe.skipIf(!brokers)('real Kafka round trip', () => {
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
    const publisher = new PublishingProcessor(
      new ConfigService({ KAFKA_BROKERS: brokers, KAFKA_SSL: false }),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
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
        language: 'he',
        matches: ['news'],
      });
    } finally {
      clearTimeout(timeout);
      await Promise.allSettled([
        publisher.onModuleDestroy(),
        consumer.disconnect(),
        admin.disconnect(),
      ]);
    }
  }, 60000);
});
