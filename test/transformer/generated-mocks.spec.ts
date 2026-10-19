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
import type { ScrapedPost } from '../../src/x-scraper/contracts/x-scraper.interfaces.js';
import { provisionalRawReportSchema } from '../../src/contracts/provisional-raw-report.schema.js';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import {
  createMockBatchResult,
  createMockScrapedPost,
} from './fixtures/mock-generators.js';
import { realtimeInput, telegramInput, workflow } from './fixtures.js';

const send = vi.fn<(record: ProducerRecord) => Promise<RecordMetadata[]>>();
let publisher: PublishingProcessor;
const ajv = new Ajv({ allErrors: true });
addFormats.default(ajv);
const validate = ajv.compile(provisionalRawReportSchema);

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

function reports() {
  return send.mock.calls.map(([record]) => {
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
    expect(typeof report.report_id).toBe('number');
    expect(Number.isInteger(report.report_id)).toBe(true);
    expect(report.report_id).toBeGreaterThanOrEqual(-2147483648);
    expect(report.report_id).toBeLessThanOrEqual(2147483647);
    expect(report.schema_version).toBe('1.0.0');
    expect(report.is_official).toBe(false);
    return report;
  });
}

describe('generated ProfileScrapeResult variations', () => {
  it.each(Array.from({ length: 30 }, (_, index) => index))(
    'runs variation %i through every processor and checks the serialized Kafka schema',
    async (index) => {
      const contents = [
        'English content',
        'دليل اختبار باللغة العربية',
        'בדיקת תוכן בעברית',
        'Café: 1 < 2 & 3 > 2',
      ];
      const posts = Array.from({ length: (index % 5) + 1 }, (_, postIndex) => {
        const post = createMockScrapedPost({
          url: `https://x.com/mock_${index}/status/${postIndex}?original=%2F`,
          authorHandle: `mock_${index}_${postIndex}`,
          text: `  ${contents[index % contents.length]} ${postIndex}  `,
          publishedAt:
            index % 2
              ? '2026-10-19T17:30:00+03:00'
              : '2026-10-19T14:30:00.000Z',
          media:
            index % 3 === 0
              ? []
              : [
                  {
                    type: index % 3 === 1 ? 'photo' : 'video',
                    url: 'https://example.com/media',
                  },
                ],
          rawHtmlSnippet: '<p>Ignored HTML from collector</p>',
        });
        // Future collector JSON may add this field without requiring an input wrapper.
        if (postIndex % 2 === 1) Reflect.set(post, 'language', 'ar');
        return post;
      });
      const payload = createMockBatchResult({
        posts,
        scrapedAt: '2026-10-19T18:00:00+03:00',
      });
      const original = structuredClone(payload);
      const result = await workflow(publisher).run(
        'ProfileScrapeResult',
        payload,
      );
      const output = reports();
      expect(result).toHaveLength(posts.length);
      expect(output).toHaveLength(posts.length);
      for (const [postIndex, report] of output.entries()) {
        expect(report.account_name).toBe(posts[postIndex]!.authorHandle);
        expect(report.content).toBe(
          posts[postIndex]!.text.normalize('NFC').trim(),
        );
        expect(report.report_url).toBe(posts[postIndex]!.url);
        expect(report.language).toBe(postIndex % 2 ? 'ar' : 'unknown');
        expect(report.media_type).toEqual([
          'text',
          ...posts[postIndex]!.media.map((media) => media.type),
        ]);
        expect(report.published_at).toBe('2026-10-19T14:30:00.000Z');
        expect(report.collected_at).toBe('2026-10-19T15:00:00.000Z');
      }
      expect(payload).toEqual(original);
    },
  );

  it.each([undefined, null, '', '   ', '\n\t', 'unknown'])(
    'defaults missing/empty collector language %j to unknown',
    async (language) => {
      const post = createMockScrapedPost();
      Reflect.set(post, 'language', language);
      await workflow(publisher).run(
        'ProfileScrapeResult',
        createMockBatchResult({ posts: [post] }),
      );
      expect(reports()[0]!.language).toBe('unknown');
    },
  );

  it('preserves per-post collector languages over optional batch metadata', async () => {
    const posts = ['en', 'ar', 'he'].map((language) => {
      const post = createMockScrapedPost();
      Reflect.set(post, 'language', language);
      return post;
    });
    await workflow(publisher).run(
      'ProfileScrapeResult',
      createMockBatchResult({ posts }),
      { language: 'fr' },
    );
    expect(reports().map((report) => report.language)).toEqual([
      'en',
      'ar',
      'he',
    ]);
  });

  it.each([undefined, null, '', '  '])(
    'accepts missing/empty optional caller language %j',
    async (language) => {
      await workflow(publisher).run(
        'ProfileScrapeResult',
        createMockBatchResult(),
        { language },
      );
      expect(reports()[0]!.language).toBe('unknown');
    },
  );

  it.each(['zz', 'eng', 'EN', 'not-a-language', 42, {}, ['en']])(
    'rejects an invalid collector language %j without publishing',
    async (language) => {
      const post = createMockScrapedPost();
      Reflect.set(post, 'language', language);
      await expect(
        workflow(publisher).run(
          'ProfileScrapeResult',
          createMockBatchResult({ posts: [post] }),
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each(['', ' ', '\n\t', null, undefined, 42, '<p>HTML</p>'])(
    'rejects invalid content %j before any record in the batch is published',
    async (text) => {
      const invalid = createMockScrapedPost();
      Reflect.set(invalid, 'text', text);
      await expect(
        workflow(publisher).run(
          'ProfileScrapeResult',
          createMockBatchResult({ posts: [createMockScrapedPost(), invalid] }),
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    { url: 'not a URL' },
    { publishedAt: 'not a date' },
    { authorHandle: 42 },
    { media: [{ type: '', url: 'https://example.com/media' }] },
  ])('rejects invalid source fields %j without publication', async (fields) => {
    const post = createMockScrapedPost(fields as Partial<ScrapedPost>);
    // Non-string account values remain invalid; nullable names follow the local contract.
    const error = fields.publishedAt ? 'mapping_failed' : 'validation_failed';
    await expect(
      workflow(publisher).run(
        'ProfileScrapeResult',
        createMockBatchResult({ posts: [post] }),
      ),
    ).rejects.toMatchObject({ code: error });
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects invalid collection time without publication', async () => {
    await expect(
      workflow(publisher).run(
        'ProfileScrapeResult',
        createMockBatchResult({ scrapedAt: 'not a date' }),
      ),
    ).rejects.toMatchObject({ code: 'mapping_failed' });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('language handling in both Telegram formats', () => {
  it('defaults a StoredMessage language to unknown and preserves a supplied collector code', async () => {
    const runner = workflow(publisher);
    await runner.run('StoredMessage', telegramInput());
    const message = telegramInput();
    Reflect.set(message, 'language', 'he');
    await runner.run('StoredMessage', message);
    expect(reports().map((report) => report.language)).toEqual([
      'unknown',
      'he',
    ]);
  });

  it('defaults MessageDto language to unknown and preserves a supplied collector code', async () => {
    const runner = workflow(publisher);
    const options = {
      reportUrl: 'https://t.me/blitz/8',
      collectedAt: '2026-10-19T10:00:00Z',
    };
    await runner.run('MessageDto', realtimeInput(), options);
    const message = realtimeInput();
    Reflect.set(message, 'language', 'ar');
    await runner.run('MessageDto', message, options);
    expect(reports().map((report) => report.language)).toEqual([
      'unknown',
      'ar',
    ]);
  });
});
