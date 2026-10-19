import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProducerRecord } from 'kafkajs';
import { CompletionProcessor } from '../../src/transformer/processors/completion.processor.js';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import {
  context,
  rawReport,
  realtimeInput,
  telegramInput,
  twitterInput,
  workflow,
} from './fixtures.js';

const kafka = vi.hoisted(() => ({
  configure: vi.fn(),
  producer: vi.fn(),
  connect: vi.fn(),
  send: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('kafkajs', () => ({
  logLevel: { NOTHING: 0 },
  Kafka: class {
    constructor(config: unknown) {
      kafka.configure(config);
    }
    producer(config: unknown) {
      kafka.producer(config);
      return {
        connect: kafka.connect,
        send: kafka.send,
        disconnect: kafka.disconnect,
      };
    }
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  kafka.connect.mockResolvedValue(undefined);
  kafka.send.mockResolvedValue([]);
  kafka.disconnect.mockResolvedValue(undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function publisher(overrides: Record<string, unknown> = {}) {
  return new PublishingProcessor(
    new ConfigService({ KAFKA_BROKERS: 'broker:9092', ...overrides }),
  );
}

function publishingContext() {
  return { ...context(), reports: [rawReport()] };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Kafka publication', () => {
  it.each([-2147483648, 0, 2147483647])(
    'serializes int32 boundary %s as a JSON number with a string Kafka key',
    async (id) => {
      const ctx = { ...context(), reports: [rawReport({ report_id: id })] };
      await publisher().execute(ctx);
      const record = kafka.send.mock.calls[0]![0] as ProducerRecord;
      expect(record.messages[0]!.key).toBe(String(id));
      const parsed = JSON.parse(record.messages[0]!.value as string);
      expect(parsed.report_id).toBe(id);
      expect(typeof parsed.report_id).toBe('number');
    },
  );

  it('sends JSON to reports.raw with the exact decimal string key and all-replica acknowledgment', async () => {
    const processor = publisher();
    const ctx = publishingContext();
    await processor.execute(ctx);
    expect(kafka.send).toHaveBeenCalledExactlyOnceWith({
      topic: 'reports.raw',
      acks: -1,
      messages: [{ key: '2147483647', value: JSON.stringify(ctx.reports[0]) }],
    });
    expect(kafka.producer).toHaveBeenCalledWith({
      allowAutoTopicCreation: false,
    });
    expect(ctx.publishedReports).toEqual(ctx.reports);
    await processor.onModuleDestroy();
    expect(kafka.disconnect).toHaveBeenCalledOnce();
  });

  it('reads comma-separated bootstrap addresses, TLS and SASL from configuration', async () => {
    const processor = publisher({
      KAFKA_BROKERS: ' first:9092, [::1]:9093 ',
      KAFKA_CLIENT_ID: 'custom-client',
      KAFKA_SSL: 'true',
      KAFKA_SASL_MECHANISM: 'scram-sha-512',
      KAFKA_SASL_USERNAME: 'test-user',
      KAFKA_SASL_PASSWORD: 'test-password',
    });
    await processor.execute(publishingContext());
    expect(kafka.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        brokers: ['first:9092', '[::1]:9093'],
        clientId: 'custom-client',
        ssl: true,
        sasl: {
          mechanism: 'scram-sha-512',
          username: 'test-user',
          password: 'test-password',
        },
      }),
    );
  });

  it.each([
    '',
    ' , ',
    'http://broker:9092',
    'broker',
    'broker:0',
    'broker:65536',
  ])(
    'rejects missing or invalid native broker addresses (%s) before connecting',
    async (brokers) => {
      await expect(
        publisher({ KAFKA_BROKERS: brokers }).execute(publishingContext()),
      ).rejects.toMatchObject({ code: 'publication_failed' });
      expect(kafka.configure).not.toHaveBeenCalled();
    },
  );

  it.each([
    { KAFKA_SSL: 'yes' },
    { KAFKA_SASL_USERNAME: 'user' },
    { KAFKA_SASL_PASSWORD: 'password' },
    {
      KAFKA_SASL_USERNAME: 'user',
      KAFKA_SASL_PASSWORD: 'password',
      KAFKA_SASL_MECHANISM: 'invalid',
    },
  ])('rejects invalid security configuration (%j)', async (settings) => {
    await expect(
      publisher(settings).execute(publishingContext()),
    ).rejects.toMatchObject({ code: 'publication_failed' });
    expect(kafka.connect).not.toHaveBeenCalled();
  });

  it('waits for the broker acknowledgment before recording completion', async () => {
    const ack = deferred();
    kafka.send.mockReturnValueOnce(ack.promise);
    const processor = publisher();
    const ctx = publishingContext();
    const running = processor.execute(ctx);
    await vi.waitFor(() => expect(kafka.send).toHaveBeenCalledOnce());
    expect(ctx.publishedReports).toEqual([]);
    await expect(new CompletionProcessor().execute(ctx)).rejects.toThrow();
    ack.resolve();
    await running;
    expect(ctx.publishedReports).toEqual(ctx.reports);
  });

  it('sends every supplied report, including repeated identities, without filtering', async () => {
    const processor = publisher();
    const ctx = publishingContext();
    ctx.reports.push(structuredClone(ctx.reports[0]!));
    await processor.execute(ctx);
    await processor.execute(publishingContext());
    expect(kafka.send).toHaveBeenCalledTimes(3);
    expect(kafka.connect).toHaveBeenCalledOnce();
  });

  it('shares an in-flight connection between concurrent calls', async () => {
    const connected = deferred();
    kafka.connect.mockReturnValueOnce(connected.promise);
    const processor = publisher();
    const first = processor.execute(publishingContext());
    const second = processor.execute(publishingContext());
    expect(kafka.connect).toHaveBeenCalledOnce();
    expect(kafka.send).not.toHaveBeenCalled();
    connected.resolve();
    await Promise.all([first, second]);
    expect(kafka.send).toHaveBeenCalledTimes(2);
  });

  it('does not expose Kafka error details and allows a fresh connection after a failed connect', async () => {
    kafka.connect.mockRejectedValueOnce(
      new Error('sensitive broker information'),
    );
    const processor = publisher();
    const ctx = publishingContext();
    await expect(processor.execute(ctx)).rejects.toMatchObject({
      code: 'publication_failed',
      message:
        'Kafka publication was not confirmed; some reports may already have been delivered.',
    });
    expect(ctx.publishedReports).toEqual([]);
    await processor.execute(ctx);
    expect(kafka.connect).toHaveBeenCalledTimes(2);
    expect(kafka.send).toHaveBeenCalledOnce();
  });

  it('stops a batch on a failed send and only records acknowledged reports', async () => {
    kafka.send
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('unavailable'));
    const ctx = publishingContext();
    ctx.reports.push(rawReport({ report_id: 2 }), rawReport({ report_id: 3 }));
    await expect(publisher().execute(ctx)).rejects.toMatchObject({
      code: 'publication_failed',
    });
    expect(kafka.send).toHaveBeenCalledTimes(2);
    expect(ctx.publishedReports).toEqual([ctx.reports[0]]);
  });

  it('waits for an in-flight send before disconnecting and rejects new work during shutdown', async () => {
    const ack = deferred();
    kafka.send.mockReturnValueOnce(ack.promise);
    const processor = publisher();
    const running = processor.execute(publishingContext());
    await vi.waitFor(() => expect(kafka.send).toHaveBeenCalledOnce());
    const closing = processor.onModuleDestroy();
    expect(kafka.disconnect).not.toHaveBeenCalled();
    await expect(processor.execute(publishingContext())).rejects.toMatchObject({
      code: 'publication_failed',
    });
    ack.resolve();
    await Promise.all([running, closing]);
    expect(kafka.disconnect).toHaveBeenCalledOnce();
  });

  it('does not connect for an empty validated response', async () => {
    const ctx = { ...context(), reports: [] };
    await publisher().execute(ctx);
    expect(kafka.connect).not.toHaveBeenCalled();
    expect(ctx.publishedReports).toEqual([]);
  });
});

describe('Transformer workflow through the Kafka boundary', () => {
  it.each(['ProfileScrapeResult', 'StoredMessage', 'MessageDto'] as const)(
    'accepts the original %s object directly',
    async (format) => {
      const runner = workflow(publisher());
      const options = {
        inputId: 'workflow-input',
        language: format === 'ProfileScrapeResult' ? 'he' : 'en',
        reportUrl: 'https://t.me/blitz/8',
        collectedAt: '2026-10-19T10:00:00Z',
      };
      const result =
        format === 'ProfileScrapeResult'
          ? await runner.run(format, twitterInput(), options)
          : format === 'StoredMessage'
            ? await runner.run(format, telegramInput(), options)
            : await runner.run(format, realtimeInput(), options);
      const sent = kafka.send.mock.calls[0]![0] as ProducerRecord;
      const report = JSON.parse(sent.messages[0]!.value as string);
      expect(result).toEqual([
        {
          status: 'completed',
          inputId: 'workflow-input',
          reportId: report.report_id,
        },
      ]);
      expect(report).toMatchObject({
        schema_version: '1.0.0',
        is_official: false,
        language: options.language,
      });
    },
  );

  it('validates all ProfileScrapeResult posts before publishing anything', async () => {
    const input = twitterInput();
    input.posts.push({ ...structuredClone(input.posts[0]!), text: '   ' });
    await expect(
      workflow(publisher()).run('ProfileScrapeResult', input, {
        language: 'he',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(kafka.send).not.toHaveBeenCalled();
  });

  it('rejects a malformed source structure without publishing', async () => {
    const input = twitterInput();
    Reflect.deleteProperty(input.posts[0]!, 'media');
    await expect(
      workflow(publisher()).run('ProfileScrapeResult', input, {
        language: 'he',
      }),
    ).rejects.toMatchObject({ code: 'mapping_failed' });
    expect(kafka.send).not.toHaveBeenCalled();
  });

  it('rejects a failed publication without logging a completed result', async () => {
    kafka.send.mockRejectedValueOnce(new Error('unavailable'));
    await expect(
      workflow(publisher()).run('ProfileScrapeResult', twitterInput(), {
        language: 'he',
      }),
    ).rejects.toMatchObject({ code: 'publication_failed' });
    expect(Logger.prototype.log).not.toHaveBeenCalled();
  });

  it('handles an empty ProfileScrapeResult without connecting to Kafka', async () => {
    const input = twitterInput();
    input.posts = [];
    expect(
      await workflow(publisher()).run('ProfileScrapeResult', input, {
        language: 'he',
      }),
    ).toEqual([]);
    expect(kafka.configure).not.toHaveBeenCalled();
  });

  it('does not require the caller to create inputId or source fields', async () => {
    const result = await workflow(publisher()).run(
      'StoredMessage',
      telegramInput(),
      { language: 'en' },
    );
    expect(result[0]!.inputId).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('rejects an array where a single StoredMessage is expected', async () => {
    await expect(
      workflow(publisher()).run('StoredMessage', [telegramInput()] as never, {
        language: 'en',
      }),
    ).rejects.toMatchObject({ code: 'parsing_failed' });
    expect(kafka.send).not.toHaveBeenCalled();
  });

  it('reports missing MessageDto URL or collection time explicitly', async () => {
    await expect(
      workflow(publisher()).run('MessageDto', realtimeInput(), {
        language: 'en',
      } as never),
    ).rejects.toMatchObject({
      code: 'mapping_failed',
      message: expect.stringContaining('reportUrl and collectedAt'),
    });
    expect(kafka.send).not.toHaveBeenCalled();
  });

  it('rejects unsupported formats instead of guessing from object fields', async () => {
    await expect(
      workflow(publisher()).run('unknown' as never, twitterInput(), {
        language: 'he',
      }),
    ).rejects.toMatchObject({ code: 'unsupported_format' });
    expect(kafka.send).not.toHaveBeenCalled();
  });
});
