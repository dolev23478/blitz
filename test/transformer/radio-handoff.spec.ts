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
const analyze = vi.hoisted(() => vi.fn());
vi.mock('../../src/text-analyzer.js', () => ({ analyzeText: analyze }));
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
  analyze
    .mockReset()
    .mockReturnValue({
      matched: true,
      languages: ['en'],
      language: 'en',
      terms: ['report'],
      issues: [],
      evaluation: {
        mode: 'dictionary_only',
        threatCategories: ['context.alert'],
        riskScore: 20,
        riskLevel: 'medium',
        flaggedReasons: ['Dictionary term matched'],
      },
    });
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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
    expect(Logger.prototype.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'radio_kafka_sending',
        key: String(report.report_id),
        payload: report,
      }),
    ); // This exact wire payload is logged before the transport is called.
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
    matches: ['report'],
    categories: ['context.alert'],
    report_url: `https://blitz.example.com/api/radio/clips/${result.clips[0]!.clipId}`,
  });
});

it('archives no-speech clips and never sends them to Kafka', async () => {
  capture.mockResolvedValue({ ...captured, text: '', language: 'unknown' });
  const result = await radio.collectOnce([station]);
  expect(result.clips[0]!.status).toBe('no_speech');
  expect(result.failedStations).toEqual([]);
  expect(send).not.toHaveBeenCalled();
  expect(analyze).not.toHaveBeenCalled();
  expect(Logger.prototype.log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'radio_filter_result',
      passed: false,
      reason: 'no_speech',
    }),
  );
});

it('archives unmatched text, logs its rejection and never invokes publication', async () => {
  analyze.mockReturnValue({
    matched: false,
    languages: ['en'],
    language: 'en',
    terms: [],
    issues: [],
  });
  const result = await radio.collectOnce([station]);
  expect(result.clips).toHaveLength(1);
  expect(result.failedStations).toEqual([]);
  expect(analyze).toHaveBeenCalledWith(captured.text, 'auto');
  expect(send).not.toHaveBeenCalled();
  expect(Logger.prototype.log).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'radio_filter_result',
      passed: false,
      reason: 'no_dictionary_match',
    }),
  );
  expect((await radio.readClip(result.clips[0]!.clipId)).text).toBe(
    captured.text,
  );
});

it('keeps ASR language as ISO metadata when an emoji dictionary was matched', async () => {
  capture.mockResolvedValue({ ...captured, language: 'fa' });
  analyze.mockReturnValue({
    matched: true,
    languages: ['em'],
    language: 'em',
    terms: ['emoji-match'],
    issues: [],
  });
  const result = await radio.collectOnce([station]);
  expect(result.failedStations).toEqual([]);
  expect(
    JSON.parse(send.mock.calls[0]![0].messages[0].value).languages,
  ).toEqual(['fa']);
  expect(
    (await radio.readClip(result.clips[0]!.clipId)).languages,
  ).toBeUndefined(); // Original archive is not enriched in place.
});

it('fails closed on analyzer errors and keeps the original archived clip', async () => {
  analyze.mockImplementation(() => {
    throw new Error('Dictionary loading failed');
  });
  const result = await radio.collectOnce([station]);
  expect(result.failedStations).toEqual([station.id]);
  expect(send).not.toHaveBeenCalled();
  expect((await radio.readClip(result.clips[0]!.clipId)).text).toBe(
    captured.text,
  );
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
