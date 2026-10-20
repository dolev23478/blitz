import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Kafka, logLevel } from 'kafkajs';
import { describe, expect, it } from 'vitest';
import { REPORT_TOPIC } from '../../src/common/constants.js';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import { metadata, twitterInput, workflow } from './fixtures.js';

const brokers = process.env.KAFKA_TEST_BROKERS?.split(',')
  .map((address) => address.trim())
  .filter(Boolean);

describe.runIf(Boolean(brokers?.length))('real Kafka round trip', () => {
  it('publishes a mapped report and consumes the exact key and JSON value', async () => {
    const kafkaBrokers = brokers!;
    const client = new Kafka({
      clientId: 'blitz-transformer-test',
      brokers: kafkaBrokers,
      logLevel: logLevel.NOTHING,
      connectionTimeout: 3000,
      retry: { retries: 0 },
    });
    const admin = client.admin();
    const consumer = client.consumer({
      groupId: `blitz-transformer-test-${randomUUID()}`,
    });
    const publisher = new PublishingProcessor(
      new ConfigService({
        KAFKA_BROKERS: kafkaBrokers.join(','),
        KAFKA_SSL: false,
      }),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      await admin.connect();
      await admin.createTopics({
        topics: [{ topic: REPORT_TOPIC, numPartitions: 1, replicationFactor: 1 }],
      });
      await consumer.connect();
      await consumer.subscribe({ topic: REPORT_TOPIC, fromBeginning: true });

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

      void received.catch(() => undefined);
      await consumer.run({
        eachMessage: async ({ message }) => {
          const value = message.value?.toString();
          if (!value) return;
          try {
            const report = JSON.parse(value);
            if (report.content === marker) accept({ key: message.key!.toString(), value });
          } catch {
            // Ignore malformed messages from a shared test topic.
          }
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
        consumer.stop(),
        consumer.disconnect(),
        admin.disconnect(),
        publisher.onModuleDestroy(),
      ]);
    }
  }, 60000);
});
