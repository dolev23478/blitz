import { ConfigService } from '@nestjs/config';
import type { ProfileScrapeResult } from '../../src/x-scraper/contracts/x-scraper.interfaces.js';
import type { StoredMessage } from '../../src/types.js';
import type { MessageDto } from '../../src/tg-realtime/types.js';
import type {
  MappingFormat,
  ReportMetadata,
} from '../../src/contracts/mappings.js';
import type { RawReport } from '../../src/contracts/schema.js';
import { CompletionProcessor } from '../../src/transformer/processors/completion.processor.js';
import { MappingProcessor } from '../../src/transformer/processors/mapping.processor.js';
import { ParsingProcessor } from '../../src/transformer/processors/parsing.processor.js';
import { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import { ValidationProcessor } from '../../src/transformer/processors/validation.processor.js';
import { TelegramMappingStrategy } from '../../src/transformer/strategies/telegram-mapping.strategy.js';
import { TelegramRealtimeMappingStrategy } from '../../src/transformer/strategies/telegram-realtime-mapping.strategy.js';
import { TwitterMappingStrategy } from '../../src/transformer/strategies/twitter-mapping.strategy.js';
import { TransformerWorkflow } from '../../src/transformer/transformer.workflow.js';
import type { TransformContext } from '../../src/transformer/transformer.types.js';

export function twitterInput(): ProfileScrapeResult {
  return {
    handle: 'blitz',
    providerUsed: 'collector',
    totalPosts: 1,
    scrapedAt: '2026-10-19T13:00:00+03:00',
    posts: [
      {
        id: '1847321098492019482',
        url: 'https://x.com/blitz/status/1847321098492019482?x=%2f',
        authorHandle: 'blitz',
        authorName: 'Blitz',
        text: '  דיווח חדש  ',
        publishedAt: '2026-10-19T12:00:00+03:00',
        metrics: { replies: 1, retweets: 2, likes: 3, views: 4, bookmarks: 5 },
        media: [{ type: 'photo', url: 'https://example.com/photo.jpg' }],
        isRetweet: false,
        isPinned: false,
        rawHtmlSnippet: '<p>IGNORED</p>',
      },
    ],
  };
}

export function telegramInput(): StoredMessage {
  return {
    id: 1,
    channelId: 2,
    messageId: 7,
    channel: 'blitz',
    channelTitle: 'Blitz News',
    postedAt: new Date('2026-10-19T09:00:00Z'),
    fetchedAt: new Date('2026-10-19T10:00:00Z'),
    senderName: 'Dana',
    text: '  Telegram report  ',
    url: 'https://t.me/blitz/7?single',
    views: null,
    media: [],
    links: [],
    forwardedFrom: null,
    edited: false,
  };
}

export function realtimeInput(): MessageDto {
  return {
    chatId: -10012345,
    chatTitle: 'Blitz News',
    messageId: 8,
    date: '2026-10-19T09:00:00Z',
    editDate: null,
    isEdit: false,
    senderId: 20,
    senderName: 'Dana',
    text: 'Live Telegram report',
    metrics: {
      views: null,
      forwards: null,
      reactions: [],
      commentsCount: null,
    },
    media: null,
  };
}

export function metadata(
  format: MappingFormat = 'ProfileScrapeResult',
): ReportMetadata {
  if (format === 'ProfileScrapeResult')
    return { language: 'he', matches: ['news'] };
  if (format === 'MessageDto')
    return {
      language: 'en',
      reportUrl: 'https://t.me/blitz/8',
      collectedAt: '2026-10-19T10:00:00Z',
    };
  return { language: 'en' };
}

export function rawReport(overrides: Partial<RawReport> = {}): RawReport {
  return {
    report_id: '9223372036854775807',
    schema_version: '1.0.0',
    is_official: false,
    platform: 'telegram',
    account_name: 'Dana',
    channel_name: 'Blitz News',
    report_url: 'https://t.me/blitz/7',
    media_type: ['text'],
    report_title: null,
    content: 'Telegram report',
    language: 'en',
    matches: [],
    published_at: '2026-10-19T09:00:00.000Z',
    collected_at: '2026-10-19T10:00:00.000Z',
    ...overrides,
  };
}

export function context(
  input: unknown = twitterInput(),
  format: MappingFormat = 'ProfileScrapeResult',
  reportMetadata: ReportMetadata = metadata(format),
): TransformContext {
  return {
    input,
    format,
    metadata: reportMetadata,
    inputId: 'test-input',
    sourceId: format,
    attempt: 1,
  };
}

export function mappingProcessor(): MappingProcessor {
  return new MappingProcessor(
    new TwitterMappingStrategy(),
    new TelegramMappingStrategy(),
    new TelegramRealtimeMappingStrategy(),
  );
}

export function workflow(publisher: PublishingProcessor): TransformerWorkflow {
  return new TransformerWorkflow(
    new ParsingProcessor(),
    mappingProcessor(),
    new ValidationProcessor(new ConfigService()),
    publisher,
    new CompletionProcessor(),
  );
}
