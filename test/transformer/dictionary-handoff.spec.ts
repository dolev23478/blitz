import { FilteredPostsService } from '../../src/events/filtered-posts.service.js';
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

// Same handoff as telegram-handoff.spec.ts, but with the real analyzer and the shipped dictionaries.
vi.mock('../../src/telegram/telegram.service.js', () => ({
  TelegramService: class {},
}));
vi.mock('../../src/redis/redis.service.js', () => ({ RedisService: class {} }));

let publisher: PublishingProcessor;
let deliver: (event: NewMessagesEvent) => void | Promise<void>;
const send = vi.fn();

beforeEach(() => {
  send
    .mockReset()
    .mockResolvedValue([
      { topicName: 'reports.raw', partition: 0, errorCode: 0 },
    ]);
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
  new TelegramListenerService(
    telegram,
    redis,
    workflow(publisher),
    new FilteredPostsService(),
  );
});

afterEach(async () => {
  await publisher.onModuleDestroy();
  vi.restoreAllMocks();
});

async function publish(texts: string[]): Promise<Record<string, unknown>[]> {
  await deliver({
    channelId: 2,
    channel: 'blitz',
    inserted: texts.length,
    messages: texts.map((text, i) => ({
      ...telegramInput(),
      messageId: 100 + i,
      url: `https://t.me/blitz/${100 + i}`,
      text,
    })),
  });
  return send.mock.calls.map(
    ([record]) =>
      JSON.parse(
        (record as ProducerRecord).messages[0]!.value as string,
      ) as Record<string, unknown>,
  );
}

describe('dictionary → RAW_REPORT handoff', () => {
  it('publishes matched messages in every language with their terms and categories', async () => {
    const reports = await publish([
      'צבע אדום בשדרות, דווח על נפילות בשטח פתוח',
      'Riots and looting downtown, police fired tear gas',
      'إطلاق نار وعملية طعن قرب الحاجز',
      'آتش‌سوزی بزرگ و ریزش ساختمان در مرکز شهر',
    ]);
    expect(reports).toHaveLength(4);
    const expected: [string, string][] = [
      ['he', 'rockets_aerial'],
      ['en', 'riots'],
      ['ar', 'terror'],
      ['fa', 'civil_emergency'],
    ];
    expected.forEach(([language, category], i) => {
      expect(reports[i]!.languages).toEqual([language]);
      expect(
        reports[i]!.categories,
        `${language}: ${String(reports[i]!.categories)}`,
      ).toContain(category);
    });
    for (const report of reports) {
      expect((report.matches as string[]).length).toBeGreaterThan(0);
      expect(report).not.toHaveProperty('report_id');
    }
  });

  it('drops everyday messages before they reach Kafka', async () => {
    const reports = await publish([
      'בוא נשתה בירה ונדבר על השמירה מחר',
      'Merge the changes into the main branch',
      'أرى البيانات على الشاشة',
      'میگه بریم بازار',
    ]);
    expect(reports).toEqual([]);
  });
});
