import { FakeRetryQueue } from './fake-retry-queue.js';
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
import { telegramInput, workflow } from './fixtures.js';

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
    new FakeRetryQueue(),
  );
});

afterEach(async () => {
  await publisher.onModuleDestroy();
  vi.useRealTimers();
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
    expect(record.messages[0]!.key).toBeUndefined();
    expect(report.schema_version).toBe(1);
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
        expect(report.languages).toEqual(postIndex % 2 ? ['ar'] : []);
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

  it.each([undefined, null, '', '   ', '\n\t'])(
    'defaults missing/empty collector language %j to an empty array',
    async (language) => {
      const post = createMockScrapedPost();
      Reflect.set(post, 'language', language);
      await workflow(publisher).run(
        'ProfileScrapeResult',
        createMockBatchResult({ posts: [post] }),
      );
      expect(reports()[0]!.languages).toEqual([]);
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
    expect(reports().map((report) => report.languages)).toEqual([
      ['en'],
      ['ar'],
      ['he'],
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
      expect(reports()[0]!.languages).toEqual([]);
    },
  );

  it.each([
    'zz',
    'eng',
    'EN',
    'unknown',
    'not-a-language',
    42,
    {},
    ['en', 'zz'],
  ])(
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
    const error =
      fields.publishedAt || fields.media
        ? 'mapping_failed'
        : 'validation_failed';
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

describe('language handling in Telegram ParsedMessage', () => {
  it('defaults language to an empty array and preserves a supplied collector code', async () => {
    const runner = workflow(publisher);
    await runner.run('ParsedMessage', telegramInput());
    const message = telegramInput();
    Reflect.set(message, 'language', 'he');
    await runner.run('ParsedMessage', message);
    expect(reports().map((report) => report.languages)).toEqual([[], ['he']]);
  });

  it('uses caller language metadata when the collector did not provide a language field', async () => {
    const runner = workflow(publisher);
    await runner.run('ParsedMessage', telegramInput(), { language: 'ar' });
    expect(reports().map((report) => report.languages)).toEqual([['ar']]);
  });
});

describe('Telegram ParsedMessage through the complete workflow', () => {
  it.each(Array.from({ length: 20 }, (_, index) => index))(
    'maps Telegram variation %i to the exact local schema and Kafka record',
    async (index) => {
      const message = telegramInput();
      message.messageId = index + 1;
      message.url =
        index % 2
          ? `https://t.me/c/123456/${index + 1}?single&x=%2f`
          : `https://t.me/blitz/${index + 1}?single&x=%2f`;
      message.text = [
        '  Telegram report  ',
        '  הודעה בעברית  ',
        '  تقرير عربي  ',
        '  Cafe\u0301: 1 < 2  ',
      ][index % 4]!;
      message.senderName = index % 3 ? 'Dana' : null;
      const kind = (['photo', 'video', 'audio', 'document', 'other'] as const)[
        index % 5
      ]!;
      message.media =
        index % 2
          ? [
              { type: kind, url: 'https://example.com/media-1' },
              { type: kind, url: 'https://example.com/media-2' },
            ]
          : [];
      const input = index % 2 ? JSON.parse(JSON.stringify(message)) : message;
      const snapshot = structuredClone(input);

      const receivedBefore = Date.now();
      const result = await workflow(publisher).run('ParsedMessage', input);
      const [report] = reports(); // Validates the serialized output with Ajv and checks every field.
      expect(report).toEqual({
        schema_version: 1,
        is_official: false,
        platform: 'telegram',
        account_name: message.senderName,
        channel_name: null,
        report_url: message.url,
        media_type:
          index % 2 && (kind === 'photo' || kind === 'video')
            ? ['text', kind]
            : ['text'],
        report_title: null,
        content: message.text!.normalize('NFC').trim(),
        languages: [],
        categories: [],
        matches: [],
        published_at: message.postedAt.toISOString(),
        collected_at: expect.any(String),
      });
      expect(Date.parse(report.collected_at)).toBeGreaterThanOrEqual(
        receivedBefore,
      );
      expect(Date.parse(report.collected_at)).toBeLessThanOrEqual(Date.now());
      expect(result).toEqual([
        {
          status: 'completed',
          inputId: expect.any(String),
        },
      ]);
      expect(input).toEqual(snapshot);
      expect(send).toHaveBeenCalledOnce();
    },
  );

  it.each(['', ' ', '\n\t', null, undefined, 42, '<p>HTML</p>'])(
    'rejects invalid Telegram content %j before Kafka',
    async (content) => {
      const input = telegramInput();
      Reflect.set(input, 'text', content);
      await expect(
        workflow(publisher).run('ParsedMessage', input),
      ).rejects.toMatchObject({ code: 'validation_failed' });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'not a URL', null, undefined])(
    'rejects invalid Telegram URL %j without inventing a replacement',
    async (url) => {
      const input = telegramInput();
      Reflect.set(input, 'url', url);
      await expect(
        workflow(publisher).run('ParsedMessage', input),
      ).rejects.toMatchObject({ code: 'validation_failed' });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each(['zz', 'eng', 'EN', 42])(
    'rejects invalid Telegram language %j before Kafka',
    async (language) => {
      const input = telegramInput();
      Reflect.set(input, 'language', language);
      await expect(
        workflow(publisher).run('ParsedMessage', input),
      ).rejects.toMatchObject({ code: 'validation_failed' });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid Telegram publication timestamp', async () => {
    const input = telegramInput();
    Reflect.set(input, 'postedAt', 'not a date');
    await expect(
      workflow(publisher).run('ParsedMessage', input),
    ).rejects.toMatchObject({ code: 'mapping_failed' });
    expect(send).not.toHaveBeenCalled();
  });
});
