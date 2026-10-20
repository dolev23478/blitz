import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Producer, type ProducerRecord } from 'kafkajs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadioTranscript } from '../../src/radio/radio.types.js';
import { RadioMappingStrategy } from '../../src/transformer/strategies/radio-mapping.strategy.js';
import { MappingProcessor } from '../../src/transformer/processors/mapping.processor.js';
import { TwitterMappingStrategy } from '../../src/transformer/strategies/twitter-mapping.strategy.js';
import { TelegramMappingStrategy } from '../../src/transformer/strategies/telegram-mapping.strategy.js';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import { ReportValidator } from '../../src/transformer/report-validator.js';
import { ParsingProcessor } from '../../src/transformer/processors/parsing.processor.js';
import { ValidationProcessor } from '../../src/transformer/processors/validation.processor.js';
import { CompletionProcessor } from '../../src/transformer/processors/completion.processor.js';
import { TransformerWorkflow } from '../../src/transformer/transformer.workflow.js';
import { FakeRetryQueue } from './fake-retry-queue.js';

const config = new ConfigService({
  KAFKA_BROKERS: 'capture.invalid:9092',
  RADIO_PUBLIC_BASE_URL: 'https://blitz.example.com',
});
function clip(): RadioTranscript {
  return {
    clipId: '9b390cbb-73bc-4919-8931-c2498e6bbac5',
    station: {
      id: 'radio-al-balad',
      name: 'Radio Al-Balad 92.5 — Amman',
      streamUrl: 'http://s3.voscast.com:8964/;stream.mp3',
      language: 'ar',
    },
    startedAt: '2026-10-20T14:04:17.767Z',
    endedAt: '2026-10-20T14:04:19.537Z',
    durationSeconds: 30,
    text: '  أخبار المحطة  ',
    language: 'ar',
    segments: [{ start: 0, end: 30, text: 'أخبار المحطة' }],
    status: 'transcribed',
  };
}
let publisher: PublishingProcessor;
let runner: TransformerWorkflow;
const send = vi.fn();
beforeEach(() => {
  send
    .mockReset()
    .mockResolvedValue([
      { topicName: 'reports.raw', partition: 0, errorCode: 0 },
    ]);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Kafka.prototype, 'producer').mockReturnValue({
    connect: async () => undefined,
    disconnect: async () => undefined,
    send,
  } as unknown as Producer);
  publisher = new PublishingProcessor(config, new FakeRetryQueue());
  runner = new TransformerWorkflow(
    new ParsingProcessor(),
    new MappingProcessor(
      new TwitterMappingStrategy(),
      new TelegramMappingStrategy(),
      new RadioMappingStrategy(config),
    ),
    new ValidationProcessor(config),
    publisher,
    new CompletionProcessor(),
  );
});
afterEach(async () => {
  await publisher.onModuleDestroy();
  vi.restoreAllMocks();
});

describe('radio JSON through the shared Transformer workflow', () => {
  it('maps a complete radio report and serializes the exact current RAW_REPORT contract', async () => {
    const input = clip();
    const original = structuredClone(input);
    const results = await runner.run('RadioTranscript', input, {
      inputId: input.clipId,
      source: 'radio',
      matches: ['keyword'],
      categories: ['news'],
      languages: ['en'],
    });
    expect(send).toHaveBeenCalledOnce();
    const record = send.mock.calls[0]![0] as ProducerRecord;
    const message = record.messages[0]!;
    const report = JSON.parse(message.value as string);
    expect(record).toMatchObject({ topic: 'reports.raw', acks: -1 });
    expect(report).toEqual({
      report_id: expect.any(Number),
      schema_version: 1,
      is_official: false,
      platform: 'internet_radio',
      account_name: input.station.name,
      channel_name: input.station.name,
      report_title: input.station.name,
      report_url: `https://blitz.example.com/api/radio/clips/${input.clipId}`,
      media_type: ['text'],
      content: input.text.trim(),
      languages: ['ar'],
      categories: ['news'],
      matches: ['keyword'],
      published_at: null,
      collected_at: input.endedAt,
    });
    expect(report.report_id).toBeGreaterThanOrEqual(0);
    expect(report.report_id).toBeLessThanOrEqual(2147483647);
    expect(message.key).toBe(String(report.report_id));
    expect(new ReportValidator(config).validate(report)).toEqual(report);
    expect(results).toEqual([
      {
        status: 'completed',
        inputId: input.clipId,
        reportId: report.report_id,
      },
    ]);
    expect(input).toEqual(original);
  });

  it('gives two clips of the same station distinct report URLs and IDs', () => {
    const mapper = new RadioMappingStrategy(config);
    const first = mapper.map(clip(), {});
    const second = mapper.map(
      { ...clip(), clipId: 'c9f51a4a-387c-4f5f-b540-1d3ed20a115d' },
      {},
    );
    expect(first.report_url).not.toBe(second.report_url);
    expect(first.report_id).not.toBe(second.report_id);
    expect(mapper.map(clip(), {}).report_id).toBe(first.report_id);
  });

  it('preserves optional multilingual collector metadata and a valid supplied report ID', async () => {
    await runner.run(
      'RadioTranscript',
      {
        ...clip(),
        report_id: 0,
        languages: ['he', 'en'],
        categories: ['collector-category'],
        matches: ['collector-keyword'],
      },
      {
        languages: ['fa'],
        categories: ['caller-category'],
        matches: ['caller-keyword'],
      },
    );
    const record = send.mock.calls[0]![0];
    expect(record.messages[0].key).toBe('0');
    expect(JSON.parse(record.messages[0].value)).toMatchObject({
      report_id: 0,
      languages: ['he', 'en'],
      categories: ['collector-category'],
      matches: ['collector-keyword'],
    });
  });

  it('uses the current local port if no public base URL is configured', () => {
    expect(
      new RadioMappingStrategy(new ConfigService({ PORT: 3210 })).map(
        clip(),
        {},
      ).report_url,
    ).toBe(`http://localhost:3210/api/radio/clips/${clip().clipId}`);
  });

  it('maps Persian ASR language without depending on the station hint', async () => {
    await runner.run('RadioTranscript', {
      ...clip(),
      language: 'fa',
      text: 'گزارش خبری',
    });
    const report = JSON.parse(send.mock.calls[0]![0].messages[0].value);
    expect(report.languages).toEqual(['fa']);
    expect(report.categories).toEqual([]);
  });

  it.each(['', '   ', '<div>HTML instead of parsed text</div>'])(
    'rejects invalid content %j before publishing',
    async (text) => {
      await expect(
        runner.run('RadioTranscript', { ...clip(), text }),
      ).rejects.toMatchObject({ code: 'validation_failed' });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('rejects a no-speech clip passed directly to the workflow', async () => {
    await expect(
      runner.run('RadioTranscript', {
        ...clip(),
        status: 'no_speech',
        text: '',
        language: 'unknown',
        segments: [],
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { report_id: -1 },
    { report_id: '1847321098492019482' },
    { languages: ['ar', 'zz'] },
    { categories: ['news', 42] },
    { language: 'zz' },
    { language: 'unknown' },
    { endedAt: 'not-a-date' },
    { endedAt: '2026-10-19T00:00:00.000Z' },
    { clipId: '../outside' },
    { station: { ...clip().station, streamUrl: 'file:///local.wav' } },
  ])(
    'rejects malformed collector data %# before publishing',
    async (fields) => {
      await expect(
        runner.run('RadioTranscript', Object.assign(clip(), fields)),
      ).rejects.toMatchObject({ code: 'mapping_failed' });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('rejects an unsafe int64 number at the JSON boundary before mapping', async () => {
    await expect(
      runner.run('RadioTranscript', {
        ...clip(),
        report_id: Number('1847321098492019482'),
      }),
    ).rejects.toMatchObject({ code: 'parsing_failed' });
    expect(send).not.toHaveBeenCalled();
  });
});
