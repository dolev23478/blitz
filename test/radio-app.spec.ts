import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Kafka, type Producer } from 'kafkajs';
import { randomUUID } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { rm, writeFile, readdir } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_CONFIG, loadConfig } from '../src/config/app-config.js';
import { LocalRadioWorker } from '../src/radio/local-radio.worker.js';
import { RadioService } from '../src/radio/radio.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { RedisRetryQueue } from '../src/transformer/retry-queue.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { XScraperService } from '../src/x-scraper/x-scraper.service.js';
import { MessageEventsService } from '../src/events/message-events.service.js';
import { FakeRetryQueue } from './transformer/fake-retry-queue.js';
import { telegramInput, twitterInput } from './transformer/fixtures.js';

it('boots the actual three collector lifecycles and publishes each source through the shared contract (external I/O doubled)', async () => {
  const directory = resolve('.tmp', `radio-app-${randomUUID()}`);
  const settings = loadConfig({
    RADIO_ENABLED: 'true',
    RADIO_MAX_CLIPS: '1',
    RADIO_DATA_DIR: directory,
    KAFKA_BROKERS: 'capture.invalid:9092',
    REDIS_URL: 'redis://test.invalid:6379',
    TG_API_ID: '1',
    TG_API_HASH: 'test',
    TG_SESSION_STRING: 'test',
  });
  const startTelegram = vi
    .spyOn(TelegramService.prototype, 'start')
    .mockResolvedValue(undefined);
  const setIfAbsent = vi.fn().mockResolvedValue(true);
  const batch = twitterInput();
  batch.posts[0]!.text = 'A bomb was reported.';
  const scrapeBatch = vi.fn().mockResolvedValue(batch);
  const send = vi
    .fn()
    .mockResolvedValue([
      { topicName: 'reports.raw', partition: 0, errorCode: 0 },
    ]);
  const capture = vi.fn().mockImplementation(async (_station, path) => {
    await writeFile(path, 'test audio');
    return {
      startedAt: '2026-10-21T06:00:00.000Z',
      endedAt: '2026-10-21T06:00:30.000Z',
      durationSeconds: 30,
      text: 'A bomb was reported.',
      language: 'en',
      segments: [],
    };
  });
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Kafka.prototype, 'producer').mockReturnValue({
    connect: async () => undefined,
    send,
    disconnect: async () => undefined,
  } as unknown as Producer);
  let app: NestFastifyApplication | undefined;
  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(settings)
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ ...settings, KAFKA_REMOTE_BROKERS: '' }))
      .overrideProvider(XScraperService)
      .useValue({ scrapeBatch })
      .overrideProvider(LocalRadioWorker)
      .useValue({ capture, onModuleDestroy: async () => undefined })
      .overrideProvider(RedisService)
      .useValue({
        isEnabled: () => true,
        get: async () => null,
        set: async () => undefined,
        setIfAbsent,
        eval: async () => 1,
      })
      .overrideProvider(RedisRetryQueue)
      .useValue(new FakeRetryQueue())
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.useLogger(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2), {
      timeout: 5000,
    });
    expect(startTelegram).toHaveBeenCalledOnce();
    expect(setIfAbsent).toHaveBeenCalledWith(
      'telegram:session-lock',
      expect.any(String),
      120,
    );
    expect(scrapeBatch).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledOnce();
    await app.get(MessageEventsService).emit({
      channelId: 1,
      channel: 'test-channel',
      inserted: 1,
      messages: [{ ...telegramInput(), text: 'A bomb was reported.' }],
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3), {
      timeout: 5000,
    });
    const reports = send.mock.calls.map(([record]) => {
      const report = JSON.parse(record.messages[0].value);
      expect(record.messages[0].key).toBe(report.report_url);
      expect(report).not.toHaveProperty('report_id');
      expect(report.categories).toContain('terror');
      return report;
    });
    expect(reports.map((r) => r.platform).sort()).toEqual([
      'AM/FM-RADIO',
      'telegram',
      'twitter',
    ]);
    const saved = await app.get(RadioService).listClips();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.station.name).toBeTruthy();
    expect((await readdir(resolve(directory, 'clips'))).sort()).toEqual([
      saved[0]!.clipId + '.json',
      saved[0]!.clipId + '.wav',
    ]);
    const http = app.getHttpAdapter().getInstance();
    expect(
      (await http.inject({ method: 'GET', url: '/api/health' })).statusCode,
    ).toBe(200);
    expect(
      (await http.inject({ method: 'GET', url: '/health' })).statusCode,
    ).toBe(200);
    expect(
      (await http.inject({ method: 'GET', url: '/api/posts' })).json(),
    ).toHaveLength(2);
    const stats = (
      await http.inject({ method: 'GET', url: '/api/kafka/analytics/stats' })
    ).json();
    expect(stats.totalPublished).toBe(3);
    expect(stats.totalRejected).toBe(0);
    expect(
      stats.recentEvents.every(
        (event: object) => !Object.hasOwn(event, 'reportId'),
      ),
    ).toBe(true);
  } finally {
    await app?.close();
    vi.restoreAllMocks();
    expect(relative(resolve('.tmp'), directory)).toMatch(
      /^radio-app-[a-f\d-]+$/,
    );
    await rm(directory, { recursive: true, force: true });
  }
});
