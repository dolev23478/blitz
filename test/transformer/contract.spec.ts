import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, type Producer } from 'kafkajs';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import { ReportValidator } from '../../src/transformer/report-validator.js';
import {
  rawReport,
  telegramInput,
  twitterInput,
  workflow,
} from './fixtures.js';
import { FakeRetryQueue } from './fake-retry-queue.js';

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
    send,
    disconnect: async () => undefined,
  } as unknown as Producer);
});
afterEach(() => vi.restoreAllMocks());

describe.each(['telegram', 'twitter'] as const)(
  'updated %s collector contracts',
  (source) => {
    async function run(
      fields: Record<string, unknown>,
      metadata: Record<string, unknown> = {},
    ) {
      const publisher = new PublishingProcessor(
        new ConfigService({ KAFKA_BROKERS: 'capture.invalid:9092' }),
        new FakeRetryQueue(),
      );
      try {
        const runner = workflow(publisher);
        if (source === 'telegram') {
          await runner.run(
            'ParsedMessage',
            Object.assign(telegramInput(), fields),
            metadata,
          );
        } else {
          const input = twitterInput();
          Object.assign(input.posts[0]!, fields);
          await runner.run('ProfileScrapeResult', input, metadata);
        }
        const record = send.mock.calls[0]![0];
        return {
          report: JSON.parse(record.messages[0].value),
          key: record.messages[0].key,
        };
      } finally {
        await publisher.onModuleDestroy();
      }
    }
    it.each([
      { fields: { language: 'he' }, expected: ['he'] },
      { fields: { language: ['he', 'en'] }, expected: ['he', 'en'] },
      { fields: { languages: ['he', 'en'] }, expected: ['he', 'en'] },
      {
        fields: { languages: ['ar', 'en'], language: 'he' },
        expected: ['ar', 'en'],
      },
      { fields: { languages: [] }, expected: [] },
      { fields: {}, expected: [] },
    ])(
      'maps both legacy and modern language fields: $fields',
      async ({ fields, expected }) => {
        const { report, key } = await run({
          ...fields,
          report_id: 42,
          categories: ['news', 'politics'],
        });
        expect(report.languages).toEqual(expected);
        expect(report).not.toHaveProperty('language');
        expect(report.categories).toEqual(['news', 'politics']);
        expect(report.schema_version).toBe(1);
        expect(typeof report.schema_version).toBe('number');
        expect(report.report_id).toBe(42);
        expect(key).toBe('42');
      },
    );
    it('maps array metadata without inventing a collector wrapper', async () => {
      expect(
        (await run({}, { languages: ['ar', 'he'], categories: ['news'] }))
          .report,
      ).toMatchObject({ languages: ['ar', 'he'], categories: ['news'] });
    });
    it('emits the complete RAW_REPORT field set from schemas-new-2.html with the approved language override', async () => {
      const { report, key } = await run(
        {
          report_id: 42,
          languages: ['he', 'en'],
          // The reference explicitly leaves category values undefined.
          categories: ['collector-defined-category', 'another-category'],
        },
        { matches: ['news'] },
      );
      expect(Object.keys(report).sort()).toEqual(
        [
          'report_id',
          'schema_version',
          'is_official',
          'platform',
          'account_name',
          'channel_name',
          'report_url',
          'media_type',
          'report_title',
          'content',
          'languages', // Explicit user requirement overrides the table's language.
          'matches',
          'categories',
          'published_at',
          'collected_at',
        ].sort(),
      );
      expect(report).toMatchObject({
        report_id: 42,
        schema_version: 1,
        is_official: false,
        languages: ['he', 'en'],
        categories: ['collector-defined-category', 'another-category'],
        matches: ['news'],
        report_title: null,
      });
      expect(key).toBe('42');
      expect(report.platform).toBe(source === 'telegram' ? 'telegram' : 'twitter');
      expect(report.report_url).toBe(
        source === 'telegram'
          ? telegramInput().url
          : twitterInput().posts[0]!.url,
      );
      expect(report.content.trim().length).toBeGreaterThan(0);
      expect(report.collected_at).toMatch(/Z$/);
      expect(report.published_at).toMatch(/Z$/);
      expect(report.media_type).toEqual(
        source === 'telegram' ? ['text'] : ['text', 'photo'],
      );
    });
    it.each([
      { languages: ['he', 'invalid'] },
      { languages: ['he', 42] },
      { languages: ['EN'] },
      { languages: ['unknown'] },
      { categories: ['news', 42] },
      { categories: 'news' },
      { report_id: -1 },
      { report_id: 2147483648 },
      { report_id: '1847321098492019482' },
      { report_id: 1847321098492019482n },
      { report_id: Number('1847321098492019482') },
    ])(
      'rejects malformed or out-of-range metadata case %# before Kafka',
      async (fields) => {
        await expect(run(fields)).rejects.toBeInstanceOf(Error);
        expect(send).not.toHaveBeenCalled();
      },
    );
    it.each(['gif', 'animated_gif', 'audio', 'document', 'other'])(
      'applies the documented media policy to %s',
      async (type) => {
        const { report } = await run({
          media: [{ type, url: 'https://example.com/media' }],
        });
        expect(report.media_type).toEqual(
          type === 'gif' || type === 'animated_gif'
            ? ['text', 'video']
            : ['text'],
        );
      },
    );
    it('rejects unrecognized media instead of emitting an invented enum value', async () => {
      await expect(
        run({ media: [{ type: 'executable', url: 'https://example.com/x' }] }),
      ).rejects.toMatchObject({ code: 'mapping_failed' });
      expect(send).not.toHaveBeenCalled();
    });
  },
);

it('applies a configured JSON Schema, including its language/category constraints', () => {
  mkdirSync('.tmp', { recursive: true });
  const path = resolve('.tmp', `de-test-${randomUUID()}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        languages: { type: 'array', items: { enum: ['he', 'en'] } },
        categories: { type: 'array', items: { enum: ['news'] } },
      },
    }),
  );
  try {
    const validator = new ReportValidator(
      new ConfigService({ DE_RAW_REPORT_SCHEMA_PATH: path }),
    );
    expect(() =>
      validator.validate(
        rawReport({ languages: ['he', 'en'], categories: ['news'] }),
      ),
    ).not.toThrow();
    expect(() => validator.validate(rawReport({ languages: ['ar'] }))).toThrow(
      'configured DE contract',
    );
    expect(() =>
      validator.validate(rawReport({ categories: ['unapproved'] })),
    ).toThrow('configured DE contract');
  } finally {
    unlinkSync(path);
  }
});
