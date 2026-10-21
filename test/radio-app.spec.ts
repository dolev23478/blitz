import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Kafka, type Producer } from 'kafkajs';
import { randomUUID } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfig } from '../src/config/app-config.js';
import { LocalRadioWorker } from '../src/radio/local-radio.worker.js';
import { RadioService } from '../src/radio/radio.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { RedisRetryQueue } from '../src/transformer/retry-queue.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { XScraperCronService } from '../src/x-scraper/x-scraper.cron.service.js';
import { FakeRetryQueue } from './transformer/fake-retry-queue.js';

it('boots the full app with radio filtering/handoff registered alongside Telegram and X (external I/O doubled)', async () => {
  const directory = resolve('.tmp', `radio-app-${randomUUID()}`);
  const settings = loadConfig({
    RADIO_ENABLED: 'true',
    RADIO_MAX_CLIPS: '1',
    RADIO_DATA_DIR: directory,
    KAFKA_BROKERS: 'capture.invalid:9092',
  });
  const watchResults = vi.fn();
  const startX = vi.fn();
  const startTelegram = vi.fn();
  const send = vi
    .fn()
    .mockResolvedValue([
      { topicName: 'reports.raw', partition: 0, errorCode: 0 },
    ]);
  const capture = vi
    .fn()
    .mockResolvedValue({
      startedAt: '2026-10-21T06:00:00.000Z',
      endedAt: '2026-10-21T06:00:30.000Z',
      durationSeconds: 30,
      text: 'A bomb was reported.',
      language: 'en',
      segments: [],
    });
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Kafka.prototype, 'producer').mockReturnValue({
    connect: async () => undefined,
    send,
    disconnect: async () => undefined,
  } as unknown as Producer);
  let app;
  try {
    app = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(settings)
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ ...settings, KAFKA_REMOTE_BROKERS: '' }))
      .overrideProvider(TelegramService)
      .useValue({ watchResults, onModuleInit: startTelegram })
      .overrideProvider(XScraperCronService)
      .useValue({ onModuleInit: startX })
      .overrideProvider(LocalRadioWorker)
      .useValue({ capture, onModuleDestroy: async () => undefined })
      .overrideProvider(RedisService)
      .useValue({ isEnabled: () => false })
      .overrideProvider(RedisRetryQueue)
      .useValue(new FakeRetryQueue())
      .compile();
    app.useLogger(false);
    await app.init();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(startTelegram).toHaveBeenCalledOnce();
    expect(startX).toHaveBeenCalledOnce();
    expect(watchResults).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledOnce();
    expect(JSON.parse(send.mock.calls[0]![0].messages[0].value)).toMatchObject({
      platform: 'internet_radio',
      languages: ['en'],
      matches: expect.arrayContaining(['bomb']),
    });
    expect(await app.get(RadioService).listClips()).toHaveLength(1);
  } finally {
    await app?.close();
    vi.restoreAllMocks();
    expect(relative(resolve('.tmp'), directory)).toMatch(
      /^radio-app-[a-f\d-]+$/,
    );
    await rm(directory, { recursive: true, force: true });
  }
});
