import { TwitterMappingStrategy } from '../../src/transformer/strategies/twitter-mapping.strategy.js';
import { TelegramMappingStrategy } from '../../src/transformer/strategies/telegram-mapping.strategy.js';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ProfileScrapeResult } from '../../src/x-scraper/contracts/x-scraper.interfaces.js';
import type { ParsedMessage } from '../../src/types.js';
import type { ReportMetadata } from '../../src/contracts/mappings.js';
import { ParsingProcessor } from '../../src/transformer/processors/parsing.processor.js';
import { ValidationProcessor } from '../../src/transformer/processors/validation.processor.js';
import {
  context,
  metadata,
  mappingProcessor,
  telegramInput,
  twitterInput,
} from './fixtures.js';

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

async function mapReports(
  input: ProfileScrapeResult | ParsedMessage,
  overrides: ReportMetadata = {},
) {
  const format = 'posts' in input ? 'ProfileScrapeResult' : 'ParsedMessage';
  const ctx = context(input, format, { ...metadata(format), ...overrides });
  await new ParsingProcessor().execute(ctx);
  await mappingProcessor().execute(ctx);
  await new ValidationProcessor(new ConfigService()).execute(ctx);
  return ctx.reports!;
}

describe('collector JSON mapping', () => {
  it.each(['telegram', 'twitter'] as const)(
    'preserves %s collector languages and matches ahead of caller defaults',
    async (source) => {
      const input = source === 'telegram' ? telegramInput() : twitterInput();
      const message = 'posts' in input ? input.posts[0]! : input;
      message.languages = ['he', 'en'];
      message.language = 'ar';
      message.matches = ['collector-keyword'];
      message.categories = ['collector-category'];
      const [report] = await mapReports(input, {
        languages: ['fa'],
        matches: ['caller-keyword'],
        categories: ['caller-category'],
      });
      expect(report).toMatchObject({
        languages: ['he', 'en'],
        matches: ['collector-keyword'],
        categories: ['collector-category'],
      });
      expect(report).not.toHaveProperty('language');
    },
  );

  it.each(['telegram', 'twitter'] as const)(
    'normalizes legacy %s collector language and retains caller matches when none were found',
    async (source) => {
      const input = source === 'telegram' ? telegramInput() : twitterInput();
      const message = 'posts' in input ? input.posts[0]! : input;
      message.language = 'ar';
      message.matches = [];
      const [report] = await mapReports(input, {
        languages: ['en'],
        matches: ['caller-keyword'],
      });
      expect(report).toMatchObject({
        languages: ['ar'],
        matches: ['caller-keyword'],
      });
    },
  );

  it('uses X matchedLanguage when post language is missing', async () => {
    const input = twitterInput();
    input.posts[0]!.matchedLanguage = 'ar';
    expect((await mapReports(input))[0]!.languages).toEqual(['ar']);
  });

  it('keeps X batch languages and categories as defaults for posts', async () => {
    const input = twitterInput();
    input.languages = ['he', 'en'];
    input.categories = ['batch-category'];
    expect(
      (
        await mapReports(input, {
          languages: ['ar'],
          categories: ['caller-category'],
        })
      )[0],
    ).toMatchObject({
      languages: ['he', 'en'],
      categories: ['batch-category'],
    });
  });

  it('maps Twitter fields, preserves URLs and text, and ignores raw HTML', async () => {
    const input = twitterInput();
    const snapshot = structuredClone(input);
    const reports = await mapReports(input);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual({
      schema_version: 1,
      is_official: false,
      platform: 'twitter',
      account_name: 'blitz',
      channel_name: null,
      report_url: input.posts[0]!.url,
      media_type: ['text', 'photo'],
      report_title: null,
      content: 'דיווח חדש',
      languages: ['he'],
      categories: [],
      matches: ['news'],
      published_at: '2026-10-19T09:00:00.000Z',
      collected_at: '2026-10-19T10:00:00.000Z',
    });
    expect(input).toEqual(snapshot);
  });

  it('maps every Twitter post with its own author and URL', async () => {
    const input = twitterInput();
    input.posts.push({
      ...structuredClone(input.posts[0]!),
      id: '1847321098492019483',
      url: 'https://x.com/other/status/1847321098492019483',
      authorHandle: 'other',
      text: 'Second report',
    });
    const reports = await mapReports(input);
    expect(reports.map((report) => report.account_name)).toEqual([
      'blitz',
      'other',
    ]);
  });

  it('keeps plain text angle brackets and normalizes Unicode without HTML parsing', async () => {
    const input = twitterInput();
    input.posts[0]!.text = '  Cafe\u0301: 1 < 2 & 3 > 2  ';
    const [report] = await mapReports(input);
    expect(report!.content).toBe('Café: 1 < 2 & 3 > 2');
  });

  it('maps ParsedMessage without StoredMessage fields, preserving its Date and URL', async () => {
    const input = telegramInput();
    input.media = [{ type: 'video', url: 'https://example.com/video.mp4' }];
    const [report] = await mapReports(input);
    expect(report).toEqual({
      schema_version: 1,
      is_official: false,
      platform: 'telegram',
      account_name: 'Dana',
      channel_name: null,
      report_url: input.url,
      media_type: ['text', 'video'],
      report_title: null,
      content: 'Telegram report',
      languages: ['en'],
      categories: [],
      matches: [],
      published_at: '2026-10-19T09:00:00.000Z',
      collected_at: '2026-10-19T10:00:00.000Z',
    });
  });

  it('also accepts Telegram ISO timestamps received through JSON transport', async () => {
    const input = JSON.parse(JSON.stringify(telegramInput()));
    input.postedAt = '2026-10-19T12:00:00+03:00';
    const [report] = await mapReports(input, {
      collectedAt: '2026-10-19T13:00:00+03:00',
    });
    expect(report!.published_at).toBe('2026-10-19T09:00:00.000Z');
    expect(report!.collected_at).toBe('2026-10-19T10:00:00.000Z');
  });

  it('leaves unavailable Telegram names null instead of inventing them', async () => {
    const input = telegramInput();
    input.senderName = null;
    const [report] = await mapReports(input);
    expect(report!.account_name).toBeNull();
    expect(report!.channel_name).toBeNull();
  });

  it('accepts optional source names separately, while keeping the original sender name', async () => {
    const input = telegramInput();
    const names = {
      accountName: 'Fallback account',
      channelName: 'Blitz News',
    };
    const [report] = await mapReports(input, names);
    expect(report).toMatchObject({
      account_name: 'Dana',
      channel_name: 'Blitz News',
    });
    input.senderName = null;
    expect((await mapReports(input, names))[0]!.account_name).toBe(
      'Fallback account',
    );
  });

  it.each(['photo', 'video', 'audio', 'document', 'other'] as const)(
    'preserves ParsedMessage media type %s',
    async (kind) => {
      const input = telegramInput();
      input.media = [{ type: kind, url: 'https://example.com/media' }];
      const [report] = await mapReports(input);
      expect(report!.media_type).toEqual(
        kind === 'photo' || kind === 'video' ? ['text', kind] : ['text'],
      );
    },
  );

  it('returns no reports for an empty ProfileScrapeResult', async () => {
    const input = twitterInput();
    input.posts = [];
    expect(await mapReports(input)).toEqual([]);
  });

  it('each mapper accepts its original collector interface directly', () => {
    const twitter = new TwitterMappingStrategy().map(
      twitterInput(),
      metadata(),
    );
    const telegram = new TelegramMappingStrategy().map(
      telegramInput(),
      metadata('ParsedMessage'),
    );
    expect(twitter).toHaveLength(1);
    expect(telegram.report_url).toBe(telegramInput().url);
  });

  it('rejects missing Telegram text instead of publishing an empty report', async () => {
    const input = telegramInput();
    input.text = null;
    await expect(mapReports(input)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});
