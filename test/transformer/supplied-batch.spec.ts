import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import {
  Kafka,
  type Producer,
  type ProducerRecord,
  type RecordMetadata,
} from 'kafkajs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provisionalRawReportSchema } from '../../src/contracts/provisional-raw-report.schema.js';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import { mockBatchScrapeResult } from './fixtures/mock-batch-scrape-result.js';
import { workflow } from './fixtures.js';

const send = vi.fn<(record: ProducerRecord) => Promise<RecordMetadata[]>>();
let publisher: PublishingProcessor;

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
    send,
    disconnect: async () => undefined,
  } as unknown as Producer);
  publisher = new PublishingProcessor(
    new ConfigService({
      KAFKA_BROKERS: 'capture.invalid:9092',
      KAFKA_SSL: false,
      KAFKA_SASL_USERNAME: '',
      KAFKA_SASL_PASSWORD: '',
    }),
  );
});

afterEach(async () => {
  await publisher.onModuleDestroy();
  vi.restoreAllMocks();
});

const expectedReportsWithSharedLanguage = [
  {
    report_id: 3047412,
    schema_version: '1.0.0',
    is_official: false,
    platform: 'twitter',
    account_name: 'AJEnglish',
    channel_name: null,
    report_url: 'https://x.com/AJEnglish/status/1847321098492019482',
    media_type: ['text', 'photo'],
    report_title: null,
    content:
      'Breaking: Regional developments update following high-level diplomatic talks in Geneva.',
    language: ['en'],
    matches: [],
    published_at: '2026-10-19T14:15:00.000Z',
    collected_at: '2026-10-19T14:30:00.000Z',
  },
  {
    report_id: -886798368,
    schema_version: '1.0.0',
    is_official: false,
    platform: 'twitter',
    account_name: 'AJArabic',
    channel_name: null,
    report_url: 'https://x.com/AJArabic/status/1847318045123984120',
    media_type: ['text', 'video'],
    report_title: null,
    content: 'موجز الأخبار: استمرار المشاورات الدولية بشأن سبل التهدئة.',
    // Existing batch-level metadata applies this code to every post; this is a known limitation.
    language: ['en'],
    matches: [],
    published_at: '2026-10-19T14:02:10.000Z',
    collected_at: '2026-10-19T14:30:00.000Z',
  },
];

describe('the exact user-supplied ProfileScrapeResult', () => {
  it('executes the workflow and validates the serialized Kafka values against every local schema field', async () => {
    const payload = JSON.parse(JSON.stringify(mockBatchScrapeResult));
    const original = structuredClone(payload);
    const result = await workflow(publisher).run(
      'ProfileScrapeResult',
      payload,
      {
        inputId: 'supplied-example',
        language: 'en',
      },
    );
    const ajv = new Ajv({ allErrors: true });
    addFormats.default(ajv);
    const validate = ajv.compile(provisionalRawReportSchema);
    expect(send).toHaveBeenCalledTimes(2);
    const actualReports = send.mock.calls.map(([record]) => {
      expect(record.topic).toBe('reports.raw');
      expect(record.acks).toBe(-1);
      expect(record.messages).toHaveLength(1);
      expect(typeof record.messages[0]!.value).toBe('string');
      const report = JSON.parse(record.messages[0]!.value as string);
      expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
      expect(Object.keys(report).sort()).toEqual(
        [...provisionalRawReportSchema.required].sort(),
      );
      expect(record.messages[0]!.key).toBe(String(report.report_id));
      return report;
    });
    expect(actualReports).toEqual(expectedReportsWithSharedLanguage);
    expect(result).toEqual(
      actualReports.map((report) => ({
        status: 'completed',
        inputId: 'supplied-example',
        reportId: report.report_id,
      })),
    );
    expect(payload).toEqual(original);
    // Schema validity alone cannot establish the actual language of the Arabic content.
    expect(actualReports.map((report) => report.language)).not.toEqual([
      ['en'],
      ['ar'],
    ]);
  });

  it('publishes the original example without metadata using empty language arrays', async () => {
    await workflow(publisher).run('ProfileScrapeResult', mockBatchScrapeResult);
    const reports = send.mock.calls.map(([record]) =>
      JSON.parse(record.messages[0]!.value as string),
    );
    expect(reports).toEqual(
      expectedReportsWithSharedLanguage.map((report) => ({
        ...report,
        language: [],
      })),
    );
  });

  it('preserves English and Arabic correctly when the caller supplies their languages in separate calls', async () => {
    const runner = workflow(publisher);
    for (const [index, language] of ['en', 'ar'].entries()) {
      await runner.run(
        'ProfileScrapeResult',
        {
          ...mockBatchScrapeResult,
          totalPosts: 1,
          posts: [mockBatchScrapeResult.posts[index]!],
        },
        { language },
      );
    }
    const actual = send.mock.calls.map(([record]) =>
      JSON.parse(record.messages[0]!.value as string),
    );
    expect(actual).toEqual(
      expectedReportsWithSharedLanguage.map((report, index) => ({
        ...report,
        language: [index === 0 ? 'en' : 'ar'],
      })),
    );
  });

  it('publishes nothing if one post in this sample has empty content', async () => {
    const payload = structuredClone(mockBatchScrapeResult);
    payload.posts[1]!.text = ' ';
    await expect(
      workflow(publisher).run('ProfileScrapeResult', payload, {
        language: 'en',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(send).not.toHaveBeenCalled();
  });
});
