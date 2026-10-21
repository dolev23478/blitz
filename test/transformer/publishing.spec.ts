import { FakeRetryQueue } from './fake-retry-queue.js';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProducerRecord, RecordMetadata } from 'kafkajs';
import { CompletionProcessor } from '../../src/transformer/processors/completion.processor.js';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import {
  context,
  rawReport,
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

const acknowledgment: RecordMetadata[] = [
  { topicName: 'reports.raw', partition: 0, errorCode: 0 },
];

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
  kafka.send.mockResolvedValue(acknowledgment);
  kafka.disconnect.mockResolvedValue(undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function publisher(overrides: Record<string, unknown> = {}) {
  return new PublishingProcessor(
    new ConfigService({ KAFKA_BROKERS: 'broker:9092', ...overrides }),
    new FakeRetryQueue(),
  );
}

function publishingContext() {
  return { ...context(), reports: [rawReport()] };
}

function sentContents(): string[] {
  return kafka.send.mock.calls.map(
    ([record]) =>
      JSON.parse((record as ProducerRecord).messages[0]!.value as string)
        .content,
  );
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Kafka publication', () => {
  it('serializes reports as JSON without report_id or Kafka key', async () => {
    const ctx = { ...context(), reports: [rawReport()] };
    await publisher().execute(ctx);
    const record = kafka.send.mock.calls[0]![0] as ProducerRecord;
    expect(record.messages[0]!.key).toBeUndefined();
    const parsed = JSON.parse(record.messages[0]!.value as string);
    expect(parsed).not.toHaveProperty('report_id');
  });

  it('sends JSON to reports.raw with all-replica acknowledgment', async () => {
    const processor = publisher();
    const ctx = publishingContext();
    await processor.execute(ctx);
    expect(kafka.send).toHaveBeenCalledExactlyOnceWith({
      topic: 'reports.raw',
      acks: -1,
      timeout: 30000,
      messages: [{ value: expect.any(String) }],
    });
    expect(JSON.parse(kafka.send.mock.calls[0]![0].messages[0].value)).toEqual(
      ctx.reports[0],
    );
    expect(kafka.producer).toHaveBeenCalledWith(
      expect.objectContaining({
        allowAutoTopicCreation: false,
        idempotent: true,
        maxInFlightRequests: 1,
      }),
    );
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
    const ack = deferred<RecordMetadata[]>();
    kafka.send.mockReturnValueOnce(ack.promise);
    const processor = publisher();
    const ctx = publishingContext();
    const running = processor.execute(ctx);
    await vi.waitFor(() => expect(kafka.send).toHaveBeenCalledOnce());
    expect(ctx.publishedReports).toEqual([]);
    await expect(new CompletionProcessor().execute(ctx)).rejects.toThrow();
    ack.resolve(acknowledgment);
    await running;
    expect(ctx.publishedReports).toEqual(ctx.reports);
  });

  it('joins identical durable submissions while retaining distinct caller completions', async () => {
    const processor = publisher();
    const ctx = publishingContext();
    ctx.reports.push(structuredClone(ctx.reports[0]!));
    await processor.execute(ctx);
    await processor.execute(publishingContext());
    expect(kafka.send).toHaveBeenCalledTimes(1);
    expect(kafka.connect).toHaveBeenCalledOnce();
  });

  it('shares an in-flight connection between concurrent calls', async () => {
    const connected = deferred();
    kafka.connect.mockReturnValueOnce(connected.promise);
    const processor = publisher();
    const first = processor.execute(publishingContext());
    const second = processor.execute(publishingContext());
    await vi.waitFor(() => expect(kafka.connect).toHaveBeenCalledOnce());
    expect(kafka.send).not.toHaveBeenCalled();
    connected.resolve();
    await Promise.all([first, second]);
    expect(kafka.send).toHaveBeenCalledTimes(1);
  });

  it('retains the batch and reconnects after 60 seconds without exposing Kafka error details', async () => {
    vi.useFakeTimers();
    kafka.connect.mockRejectedValueOnce(
      new Error('sensitive broker information'),
    );
    const processor = publisher();
    const ctx = publishingContext();
    const running = processor.execute(ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.publishedReports).toEqual([]);
    expect(
      JSON.stringify(vi.mocked(Logger.prototype.warn).mock.calls),
    ).not.toContain('sensitive');
    await vi.advanceTimersByTimeAsync(59999);
    expect(kafka.connect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(kafka.connect).toHaveBeenCalledTimes(2);
    expect(kafka.send).toHaveBeenCalledOnce();
  });

  it('retries the failed head and retains the rest of a batch without resending confirmed reports', async () => {
    vi.useFakeTimers();
    kafka.send
      .mockResolvedValueOnce(acknowledgment)
      .mockRejectedValueOnce(new Error('unavailable'));
    const ctx = publishingContext();
    ctx.reports.push(rawReport({ content: 'report-2' }), rawReport({ content: 'report-3' }));
    const running = publisher().execute(ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect(kafka.send).toHaveBeenCalledTimes(2);
    expect(ctx.publishedReports).toEqual([ctx.reports[0]]);
    await vi.advanceTimersByTimeAsync(60000);
    await running;
    expect(sentContents()).toEqual(['Telegram report', 'report-2', 'report-2', 'report-3']);
    expect(ctx.publishedReports).toEqual(ctx.reports);
  });

  it('waits for an in-flight send before disconnecting and rejects new work during shutdown', async () => {
    const ack = deferred<RecordMetadata[]>();
    kafka.send.mockReturnValueOnce(ack.promise);
    const processor = publisher();
    const running = processor.execute(publishingContext());
    await vi.waitFor(() => expect(kafka.send).toHaveBeenCalledOnce());
    const closing = processor.onModuleDestroy();
    expect(kafka.disconnect).not.toHaveBeenCalled();
    await expect(processor.execute(publishingContext())).rejects.toMatchObject({
      code: 'publication_failed',
    });
    ack.resolve(acknowledgment);
    await Promise.all([running, closing]);
    expect(kafka.disconnect).toHaveBeenCalledOnce();
  });

  it('does not connect for an empty validated response', async () => {
    const ctx = { ...context(), reports: [] };
    await publisher().execute(ctx);
    expect(kafka.connect).not.toHaveBeenCalled();
    expect(ctx.publishedReports).toEqual([]);
  });

  it('keeps concurrent batches in FIFO order and does not reset the retry timer on new arrivals', async () => {
    vi.useFakeTimers();
    kafka.send.mockRejectedValueOnce(new Error('unavailable'));
    const processor = publisher();
    const first = {
      ...context(),
      reports: [rawReport({ content: 'report-1' }), rawReport({ content: 'report-2' })],
    };
    const second = {
      ...context(),
      reports: [rawReport({ content: 'report-3' }), rawReport({ content: 'report-4' })],
    };
    const runningFirst = processor.execute(first);
    await vi.advanceTimersByTimeAsync(30000);
    const runningSecond = processor.execute(second);
    await vi.advanceTimersByTimeAsync(29999);
    expect(sentContents()).toEqual(['report-1']);
    expect(first.publishedReports).toEqual([]);
    expect(second.publishedReports).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([runningFirst, runningSecond]);
    expect(sentContents()).toEqual(['report-1', 'report-1', 'report-2', 'report-3', 'report-4']);
    expect(first.publishedReports).toEqual(first.reports);
    expect(second.publishedReports).toEqual(second.reports);
  });

  it.each([
    undefined,
    [],
    [{ topicName: 'reports.raw', partition: 0, errorCode: 7 }],
    [{ topicName: 'wrong-topic', partition: 0, errorCode: 0 }],
  ])(
    'retains a report when send returns no successful acknowledgment (%j)',
    async (response) => {
      vi.useFakeTimers();
      kafka.send.mockResolvedValueOnce(response);
      const ctx = publishingContext();
      const running = publisher().execute(ctx);
      await vi.advanceTimersByTimeAsync(0);
      expect(ctx.publishedReports).toEqual([]);
      await vi.advanceTimersByTimeAsync(60000);
      await running;
      expect(sentContents()).toEqual(['Telegram report', 'Telegram report']);
      expect(ctx.publishedReports).toEqual(ctx.reports);
    },
  );

  it('uses the configured interval for at most three retries, including request timeout errors', async () => {
    vi.useFakeTimers();
    kafka.send
      .mockRejectedValueOnce(new Error('request timeout'))
      .mockRejectedValueOnce(new Error('broker unavailable'))
      .mockRejectedValueOnce(new Error('not enough replicas'));
    const ctx = publishingContext();
    const running = publisher({ KAFKA_RETRY_INTERVAL_MS: '2500' }).execute(ctx);
    await vi.advanceTimersByTimeAsync(0);
    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(kafka.send).toHaveBeenCalledTimes(attempt);
      expect(ctx.publishedReports).toEqual([]);
      await vi.advanceTimersByTimeAsync(2500);
    }
    await running;
    expect(kafka.send).toHaveBeenCalledTimes(4);
    expect(
      new Set(kafka.send.mock.calls.map(([record]) => JSON.stringify(record)))
        .size,
    ).toBe(1);
    expect(kafka.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        requestTimeout: 30000,
        enforceRequestTimeout: true,
        retry: { retries: 0 },
      }),
    );
  });

  it('allows only one send at a time, even when new input arrives during an active send', async () => {
    const ack = deferred<RecordMetadata[]>();
    kafka.send.mockReturnValueOnce(ack.promise);
    const processor = publisher();
    const first = processor.execute({
      ...context(),
      reports: [rawReport({ content: 'report-1' })],
    });
    await vi.waitFor(() => expect(kafka.send).toHaveBeenCalledOnce());
    const second = processor.execute({
      ...context(),
      reports: [rawReport({ content: 'report-2' })],
    });
    expect(sentContents()).toEqual(['report-1']);
    ack.resolve(acknowledgment);
    await Promise.all([first, second]);
    expect(sentContents()).toEqual(['report-1', 'report-2']);
  });

  it('retains an independent payload snapshot while queued, including later reports in the batch', async () => {
    vi.useFakeTimers();
    kafka.send.mockRejectedValueOnce(new Error('unavailable'));
    const ctx = publishingContext();
    ctx.reports.push(rawReport({ content: 'report-2' }));
    const original = structuredClone(ctx.reports);
    const running = publisher().execute(ctx);
    await vi.advanceTimersByTimeAsync(0);
    ctx.reports[0]!.content = 'changed after admission';
    ctx.reports[1]!.channel_name = 'changed';
    ctx.reports[1]!.matches.push('changed');
    await vi.advanceTimersByTimeAsync(60000);
    await running;
    expect(sentContents()).toEqual(['Telegram report', 'Telegram report', 'report-2']);
    expect(
      kafka.send.mock.calls
        .slice(1)
        .map(([record]) => JSON.parse(record.messages[0].value)),
    ).toEqual(original);
    expect(ctx.publishedReports).toEqual(original);
  });

  it('cancels pending retries on shutdown and rejects queued callers without marking reports completed', async () => {
    vi.useFakeTimers();
    kafka.send.mockRejectedValue(new Error('unavailable'));
    const processor = publisher();
    const ctx = publishingContext();
    const running = processor.execute(ctx);
    const rejected = expect(running).rejects.toMatchObject({
      code: 'publication_failed',
      message: expect.stringContaining('persisted in Redis'),
    });
    await vi.advanceTimersByTimeAsync(0);
    await processor.onModuleDestroy();
    await rejected;
    await vi.advanceTimersByTimeAsync(120000);
    expect(kafka.send).toHaveBeenCalledOnce();
    expect(kafka.disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(ctx.publishedReports).toEqual([]);
  });

  it('finishes an active send during shutdown but rejects later queued reports', async () => {
    const ack = deferred<RecordMetadata[]>();
    kafka.send.mockReturnValueOnce(ack.promise);
    const processor = publisher();
    const ctx = publishingContext();
    ctx.reports.push(rawReport({ content: 'report-2' }));
    const running = processor.execute(ctx);
    const rejected = expect(running).rejects.toMatchObject({
      code: 'publication_failed',
    });
    await vi.waitFor(() => expect(kafka.send).toHaveBeenCalledOnce());
    const closing = processor.onModuleDestroy();
    ack.resolve(acknowledgment);
    await closing;
    await rejected;
    expect(kafka.send).toHaveBeenCalledOnce();
    expect(ctx.publishedReports).toEqual([ctx.reports[0]]);
  });

  it.each([0, -1, 1.5, 'invalid', '', 2147483648])(
    'rejects an invalid retry interval (%s)',
    (interval) => {
      expect(() => publisher({ KAFKA_RETRY_INTERVAL_MS: interval })).toThrow(
        'KAFKA_RETRY_INTERVAL_MS',
      );
    },
  );
});

describe('Transformer workflow through the Kafka boundary', () => {
  it.each(['ProfileScrapeResult', 'ParsedMessage'] as const)(
    'accepts the original %s object directly',
    async (format) => {
      const runner = workflow(publisher());
      const options = {
        inputId: 'workflow-input',
        language: format === 'ProfileScrapeResult' ? 'he' : 'en',
      };
      const result =
        format === 'ProfileScrapeResult'
          ? await runner.run(format, twitterInput(), options)
          : await runner.run(format, telegramInput(), options);
      const sent = kafka.send.mock.calls[0]![0] as ProducerRecord;
      const report = JSON.parse(sent.messages[0]!.value as string);
      expect(result).toEqual([
        {
          status: 'completed',
          inputId: 'workflow-input',
          },
      ]);
      expect(report).toMatchObject({
        schema_version: 1,
        is_official: false,
        languages: [options.language],
        categories: [],
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

  it('does not complete the workflow until a failed publication has been retried and confirmed', async () => {
    vi.useFakeTimers();
    kafka.send.mockRejectedValueOnce(new Error('unavailable'));
    const running = workflow(publisher()).run(
      'ProfileScrapeResult',
      twitterInput(),
      {
        language: 'he',
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(Logger.prototype.log).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60000);
    expect((await running)[0]?.status).toBe('completed');
    expect(Logger.prototype.log).toHaveBeenCalledOnce();
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
      'ParsedMessage',
      telegramInput(),
      { language: 'en' },
    );
    expect(result[0]!.inputId).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('rejects an array where a single ParsedMessage is expected', async () => {
    await expect(
      workflow(publisher()).run('ParsedMessage', [telegramInput()] as never, {
        language: 'en',
      }),
    ).rejects.toMatchObject({ code: 'parsing_failed' });
    expect(kafka.send).not.toHaveBeenCalled();
  });

  it.each(['MessageDto', 'StoredMessage'])(
    'rejects the removed Telegram format %s',
    async (format) => {
      await expect(
        workflow(publisher()).run(format as never, telegramInput()),
      ).rejects.toMatchObject({
        code: 'unsupported_format',
      });
      expect(kafka.send).not.toHaveBeenCalled();
    },
  );

  it('captures Telegram receipt time before processing and keeps it unchanged during a Kafka retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T08:00:00.000Z'));
    kafka.send.mockRejectedValueOnce(new Error('unavailable'));
    const input = JSON.parse(JSON.stringify(telegramInput()));
    const snapshot = structuredClone(input);
    const running = workflow(publisher()).run('ParsedMessage', input, {
      // Receipt time is authoritative for Telegram, even if stale metadata is supplied.
      collectedAt: '2000-01-01T00:00:00Z',
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60000);
    await running;
    const reports = kafka.send.mock.calls.map(([record]) =>
      JSON.parse(record.messages[0].value),
    );
    expect(reports).toHaveLength(2);
    expect(reports[0]).toEqual(reports[1]);
    expect(reports[0]).toMatchObject({
      collected_at: '2026-10-20T08:00:00.000Z',
      published_at: new Date(input.postedAt).toISOString(),
      report_url: input.url,
      languages: [],
      categories: [],
    });
    expect(input).toEqual(snapshot);
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
