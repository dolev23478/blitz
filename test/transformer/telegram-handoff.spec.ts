import { FakeRetryQueue } from './fake-retry-queue.js';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Producer, type ProducerRecord } from 'kafkajs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewMessagesEvent } from '../../src/events/message-events.service.js';
import { TelegramListenerService } from '../../src/telegram/telegram-listener.service.js';
import type { TelegramService } from '../../src/telegram/telegram.service.js';
import type { RedisService } from '../../src/redis/redis.service.js';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import { telegramInput, workflow } from './fixtures.js';

// Exercise the actual handoff and Transformer without starting collectors, Redis or PostgreSQL.
vi.mock('../../src/telegram/telegram.service.js', () => ({
  TelegramService: class {},
}));
vi.mock('../../src/redis/redis.service.js', () => ({ RedisService: class {} }));
vi.mock('../../src/dictionaries/load-dictionaries.js', () => ({
  getDictionaryStore: () => ({ languages: () => ['en'] }),
}));
const analyze = vi.hoisted(() => vi.fn());
vi.mock('../../src/text-analyzer.js', () => ({ analyzeText: analyze }));

let publisher: PublishingProcessor;
let deliver: (event: NewMessagesEvent) => void | Promise<void>;
const send = vi.fn();

beforeEach(() => {
  send
    .mockReset()
    .mockResolvedValue([
      { topicName: 'reports.raw', partition: 0, errorCode: 0 },
    ]);
  analyze
    .mockReset()
    .mockReturnValue({
      matched: true,
      language: 'en',
      languages: ['en'],
      terms: ['report'],
      categories: [],
    });
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Kafka.prototype, 'producer').mockReturnValue({
    connect: async () => undefined,
    send,
    disconnect: async () => undefined,
  } as unknown as Producer);
  publisher = new PublishingProcessor(
    new ConfigService({ KAFKA_BROKERS: 'capture.invalid:9092' }),
    new FakeRetryQueue(),
  );
  const telegram = {
    watchResults: (callback: typeof deliver) => {
      deliver = callback;
      return () => undefined;
    },
  } as unknown as TelegramService;
  const redis = { isEnabled: () => false } as unknown as RedisService;
  new TelegramListenerService(telegram, redis, workflow(publisher));
});

afterEach(async () => {
  await publisher.onModuleDestroy();
  vi.restoreAllMocks();
});

describe('Telegram collector handoff', () => {
  it('passes ParsedMessage to the workflow without rebuilding its URL, timestamp, sender or media', async () => {
    const message = telegramInput();
    message.media = [{ type: 'video', url: 'https://example.com/video.mp4' }];
    const snapshot = structuredClone(message);
    await deliver({
      channelId: 2,
      channel: 'blitz',
      inserted: 1,
      messages: [message],
    });
    expect(send).toHaveBeenCalledOnce();
    const record = send.mock.calls[0]![0] as ProducerRecord;
    const report = JSON.parse(record.messages[0]!.value as string);
    expect(report).toMatchObject({
      platform: 'telegram',
      report_url: message.url,
      published_at: message.postedAt.toISOString(),
      media_type: ['text', 'video'],
      account_name: 'Dana',
      channel_name: 'blitz',
      languages: ['en'],
      categories: [],
      content: 'Telegram report',
    });
    expect(message).toEqual(snapshot);
  });

  it('keeps the same ParsedMessage path for an event received as serialized JSON', async () => {
    await deliver(
      JSON.parse(
        JSON.stringify({
          channelId: 2,
          channel: 'blitz',
          inserted: 1,
          messages: [telegramInput()],
        }),
      ),
    );
    const record = send.mock.calls[0]![0] as ProducerRecord;
    expect(JSON.parse(record.messages[0]!.value as string)).toMatchObject({
      report_url: telegramInput().url,
      published_at: telegramInput().postedAt.toISOString(),
    });
  });

  it('publishes the dictionary categories of the matched terms', async () => {
    analyze.mockReturnValue({
      matched: true,
      language: 'he',
      languages: ['he'],
      terms: ['צבע אדום', 'מחבל'],
      categories: ['תלול מסלול, ירי רקטי ואווירי', 'פח"ע'],
    });
    await deliver({ channelId: 2, channel: 'blitz', inserted: 1, messages: [telegramInput()] });
    const record = send.mock.calls[0]![0] as ProducerRecord;
    expect(JSON.parse(record.messages[0]!.value as string)).toMatchObject({
      matches: ['צבע אדום', 'מחבל'],
      categories: ['תלול מסלול, ירי רקטי ואווירי', 'פח"ע'],
    });
  });

  it('keeps upstream filtering when no keyword matched', async () => {
    analyze.mockReturnValue({ matched: false, terms: [], categories: [] });
    await deliver({
      channelId: 2,
      channel: 'blitz',
      inserted: 1,
      messages: [telegramInput()],
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('handles a notification without attached messages', async () => {
    await deliver({ channelId: 2, channel: 'blitz', inserted: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
