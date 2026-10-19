import { TwitterMappingStrategy } from '../../src/transformer/strategies/twitter-mapping.strategy.js';
import { TelegramMappingStrategy } from '../../src/transformer/strategies/telegram-mapping.strategy.js';
import { TelegramRealtimeMappingStrategy } from '../../src/transformer/strategies/telegram-realtime-mapping.strategy.js';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ProfileScrapeResult } from '../../src/x-scraper/contracts/x-scraper.interfaces.js';
import type { StoredMessage } from '../../src/types.js';
import type { MessageDto } from '../../src/tg-realtime/types.js';
import { ParsingProcessor } from '../../src/transformer/processors/parsing.processor.js';
import { ValidationProcessor } from '../../src/transformer/processors/validation.processor.js';
import {
  context,
  metadata,
  mappingProcessor,
  realtimeInput,
  telegramInput,
  twitterInput,
} from './fixtures.js';

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

async function mapReports(
  input: ProfileScrapeResult | StoredMessage | MessageDto,
) {
  const format =
    'posts' in input
      ? 'ProfileScrapeResult'
      : 'chatId' in input
        ? 'MessageDto'
        : 'StoredMessage';
  const ctx = context(input, format);
  await new ParsingProcessor().execute(ctx);
  await mappingProcessor().execute(ctx);
  await new ValidationProcessor(new ConfigService()).execute(ctx);
  return ctx.reports!;
}

describe('collector JSON mapping', () => {
  it('maps Twitter fields, preserves URLs and text, and ignores raw HTML', async () => {
    const input = twitterInput();
    const snapshot = structuredClone(input);
    const reports = await mapReports(input);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual({
      report_id: expect.any(Number),
      schema_version: '1.0.0',
      is_official: false,
      platform: 'twitter',
      account_name: 'blitz',
      channel_name: null,
      report_url: input.posts[0]!.url,
      media_type: ['text', 'photo'],
      report_title: null,
      content: 'דיווח חדש',
      language: 'he',
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
    expect(reports[0]!.report_id).not.toBe(reports[1]!.report_id);
  });

  it('keeps plain text angle brackets and normalizes Unicode without HTML parsing', async () => {
    const input = twitterInput();
    input.posts[0]!.text = '  Cafe\u0301: 1 < 2 & 3 > 2  ';
    const [report] = await mapReports(input);
    expect(report!.content).toBe('Café: 1 < 2 & 3 > 2');
  });

  it('maps stored Telegram messages with Date timestamps and sender metadata', async () => {
    const input = telegramInput();
    input.media = [{ type: 'video', url: 'https://example.com/video.mp4' }];
    const [report] = await mapReports(input);
    expect(report).toEqual({
      report_id: expect.any(Number),
      schema_version: '1.0.0',
      is_official: false,
      platform: 'telegram',
      account_name: 'Dana',
      channel_name: 'Blitz News',
      report_url: input.url,
      media_type: ['text', 'video'],
      report_title: null,
      content: 'Telegram report',
      language: 'en',
      matches: [],
      published_at: '2026-10-19T09:00:00.000Z',
      collected_at: '2026-10-19T10:00:00.000Z',
    });
  });

  it('also accepts Telegram ISO timestamps received through JSON transport', async () => {
    const input = JSON.parse(JSON.stringify(telegramInput()));
    input.postedAt = '2026-10-19T12:00:00+03:00';
    input.fetchedAt = '2026-10-19T13:00:00+03:00';
    const [report] = await mapReports(input);
    expect(report!.published_at).toBe('2026-10-19T09:00:00.000Z');
    expect(report!.collected_at).toBe('2026-10-19T10:00:00.000Z');
  });

  it('uses the Telegram channel when the sender is unavailable', async () => {
    const input = telegramInput();
    input.senderName = null;
    input.channelTitle = null;
    const [report] = await mapReports(input);
    expect(report!.account_name).toBe('blitz');
    expect(report!.channel_name).toBe('blitz');
  });

  it('maps live MessageDto with caller-supplied URL and collection time', async () => {
    const input = realtimeInput();
    const [report] = await mapReports(input);
    expect(report).toMatchObject({
      platform: 'telegram',
      account_name: 'Dana',
      channel_name: 'Blitz News',
      report_url: metadata('MessageDto').reportUrl,
      media_type: ['text'],
      content: input.text,
      language: 'en',
      matches: [],
      published_at: '2026-10-19T09:00:00.000Z',
      collected_at: '2026-10-19T10:00:00.000Z',
    });
  });

  it.each([
    'photo',
    'video',
    'voice',
    'audio',
    'document',
    'sticker',
    'other',
  ] as const)('preserves live Telegram media kind %s', async (kind) => {
    const input = realtimeInput();
    input.media = {
      kind,
      fileName: null,
      mimeType: null,
      sizeBytes: null,
      durationSec: null,
      width: null,
      height: null,
    };
    const [report] = await mapReports(input);
    expect(report!.media_type).toEqual(['text', kind]);
  });

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
      metadata('StoredMessage'),
    );
    const realtime = new TelegramRealtimeMappingStrategy().map(
      realtimeInput(),
      metadata('MessageDto'),
    );
    expect(twitter).toHaveLength(1);
    expect(telegram.report_url).toBe(telegramInput().url);
    expect(realtime.report_url).toBe(metadata('MessageDto').reportUrl);
  });

  it('rejects missing Telegram text instead of publishing an empty report', async () => {
    const input = telegramInput();
    input.text = null;
    await expect(mapReports(input)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});
