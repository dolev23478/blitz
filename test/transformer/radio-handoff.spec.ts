import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Kafka, type Producer } from 'kafkajs';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { APP_CONFIG, loadConfig } from '../../src/config/app-config.js';
import { RadioTransformerModule } from '../../src/radio/radio-transformer.module.js';
import { LocalRadioWorker } from '../../src/radio/local-radio.worker.js';
import { RadioService } from '../../src/radio/radio.service.js';
import { RedisService } from '../../src/redis/redis.service.js';
import { RedisRetryQueue } from '../../src/transformer/retry-queue.js';
import { FakeRetryQueue } from './fake-retry-queue.js';

const station = {
  id: 'test-radio',
  name: 'Test Radio',
  streamUrl: 'https://example.com/stream',
  language: 'en' as const,
};
const captured = {
  startedAt: '2026-10-20T10:00:00.000Z',
  endedAt: '2026-10-20T10:00:30.000Z',
  durationSeconds: 30,
  text: 'A public radio report',
  language: 'en',
  segments: [],
};
let directory: string;
let app: Awaited<
  ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
>;
let radio: RadioService;
const send = vi.fn();
const capture = vi.fn();
beforeEach(async () => {
  directory = resolve('.tmp', `radio-handoff-${randomUUID()}`);
  const settings = loadConfig({
    RADIO_ENABLED: 'false',
    RADIO_DATA_DIR: directory,
    RADIO_PUBLIC_BASE_URL: 'https://blitz.example.com',
    KAFKA_BROKERS: 'capture.invalid:9092',
    KAFKA_RETRY_INTERVAL_MS: '5',
  });
  send
    .mockReset()
    .mockResolvedValue([
      { topicName: 'reports.raw', partition: 0, errorCode: 0 },
    ]);
  capture.mockReset().mockResolvedValue(captured);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Kafka.prototype, 'producer').mockReturnValue({
    connect: async () => undefined,
    send,
    disconnect: async () => undefined,
  } as unknown as Producer);
  app = await Test.createTestingModule({ imports: [RadioTransformerModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(settings)
    .overrideProvider(ConfigService)
    .useValue(new ConfigService(settings))
    .overrideProvider(RedisService)
    .useValue({ isEnabled: () => false })
    .overrideProvider(RedisRetryQueue)
    .useValue(new FakeRetryQueue())
    .overrideProvider(LocalRadioWorker)
    .useValue({ capture, onModuleDestroy: async () => undefined })
    .compile();
  app.useLogger(false);
  await app.init();
  radio = app.get(RadioService);
});
afterEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
  expect(relative(resolve('.tmp'), directory)).toMatch(
    /^radio-handoff-[a-f\d-]+$/,
  );
  await rm(directory, { recursive: true, force: true });
});

it('automatically hands archived radio JSON to the real shared workflow before continuing the cycle', async () => {
  send.mockImplementation(async (record) => {
    const report = JSON.parse(record.messages[0].value);
    const clipId = report.report_url.split('/').at(-1);
    const archived = JSON.parse(
      await readFile(resolve(directory, 'clips', clipId + '.json'), 'utf8'),
    );
    expect(archived.text).toBe(captured.text); // Archive confirmed before any Kafka attempt.
    return [{ topicName: record.topic, partition: 0, errorCode: 0 }];
  });
  const result = await radio.collectOnce([station]);
  expect(result.failedStations).toEqual([]);
  expect(send).toHaveBeenCalledOnce();
  const report = JSON.parse(send.mock.calls[0]![0].messages[0].value);
  expect(report).toMatchObject({
    platform: 'internet_radio',
    media_type: ['text'],
    languages: ['en'],
    content: captured.text,
    report_url: `https://blitz.example.com/api/radio/clips/${result.clips[0]!.clipId}`,
  });
});

it('archives no-speech clips and never sends them to Kafka', async () => {
  capture.mockResolvedValue({ ...captured, text: '', language: 'unknown' });
  const result = await radio.collectOnce([station]);
  expect(result.clips[0]!.status).toBe('no_speech');
  expect(result.failedStations).toEqual([]);
  expect(send).not.toHaveBeenCalled();
});

it('retries a radio report using the existing publisher without recapturing audio', async () => {
  send.mockRejectedValueOnce(new Error('Kafka unavailable'));
  const result = await radio.collectOnce([station]);
  expect(result.failedStations).toEqual([]);
  expect(capture).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]![0].messages).toEqual(
    send.mock.calls[0]![0].messages,
  );
  expect((await radio.readClip(result.clips[0]!.clipId)).text).toBe(
    captured.text,
  );
});

it('keeps the clip after 3 failed retries and continues with the next station', async () => {
  for (let attempt = 0; attempt < 4; attempt++)
    send.mockRejectedValueOnce(new Error('Kafka unavailable'));
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const result = await radio.collectOnce([
    station,
    { ...station, id: 'second' },
  ]);
  expect(result.failedStations).toEqual(['test-radio']);
  expect(result.clips).toHaveLength(2);
  expect(capture).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledTimes(5);
  expect((await radio.readClip(result.clips[0]!.clipId)).text).toBe(
    captured.text,
  );
});

it('keeps the archive when Transformer validation fails and continues to the next station', async () => {
  capture.mockResolvedValueOnce({
    ...captured,
    text: '<div>not parsed text</div>',
  });
  const result = await radio.collectOnce([
    station,
    { ...station, id: 'second' },
  ]);
  expect(result.failedStations).toEqual(['test-radio']);
  expect(result.clips).toHaveLength(2);
  expect((await radio.readClip(result.clips[0]!.clipId)).text).toContain(
    '<div>',
  );
  expect(send).toHaveBeenCalledOnce();
});
