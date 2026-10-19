import { describe, expect, it } from 'vitest';
import { ManagedApiNormalizer } from '../src/x-scraper/parsers/managed-api.normalizer.js';
import { JsonExporter } from '../src/x-scraper/exporters/json.exporter.js';
import { HtmlExporter } from '../src/x-scraper/exporters/html.exporter.js';
import {
  XScraperService,
  scrapeBatch,
  scrapeBatchAndExport,
  scrapeProfile,
  scrapeAndExport,
  searchTweets,
  searchAndExport,
  parseSinceTimestamp,
  filterPostsByTimestamp,
} from '../src/x-scraper/x-scraper.service.js';
import { MONITORED_X_SOURCES } from '../src/x-scraper/constants/monitored-sources.js';
import type {
  IScraperProvider,
  ScrapedPost,
} from '../src/x-scraper/contracts/x-scraper.interfaces.js';

const sampleTwitterApiIoPayload = {
  status: 'success',
  msg: 'ok',
  data: {
    has_next_page: true,
    next_cursor: 'cursor-token-abc',
    tweets: [
      {
        id: '1847321098492019482',
        id_str: '1847321098492019482',
        text: 'Introducing breakthrough model with native reasoning.',
        createdAt: '2026-10-18T14:30:00.000Z',
        replyCount: 842,
        retweetCount: 2315,
        likeCount: 14890,
        viewCount: 654200,
        bookmarkCount: 1205,
        isPinned: true,
        isRetweet: false,
        author: {
          userName: 'openai',
          name: 'OpenAI',
          profilePicture: 'https://pbs.twimg.com/avatar.jpg',
        },
        entities: {
          media: [
            {
              type: 'photo',
              media_url_https: 'https://pbs.twimg.com/media/test.jpg',
            },
          ],
        },
      },
      {
        id: '1847198273645019283',
        id_str: '1847198273645019283',
        text: 'Live demo with video asset.',
        createdAt: '2026-10-17T18:00:00.000Z',
        replyCount: 350,
        retweetCount: 890,
        likeCount: 7800,
        viewCount: 410000,
        bookmarkCount: 890,
        isPinned: false,
        isRetweet: false,
        author: {
          userName: 'openai',
          name: 'OpenAI',
        },
        extendedEntities: {
          media: [
            {
              type: 'video',
              media_url_https: 'https://pbs.twimg.com/video-thumb.jpg',
              video_info: {
                variants: [
                  { bitrate: 832000, url: 'https://video.twimg.com/vid_low.mp4' },
                  { bitrate: 2176000, url: 'https://video.twimg.com/vid_high.mp4' },
                ],
              },
            },
          ],
        },
      },
    ],
  },
};

const sampleApifyPayload = [
  {
    id: '1846987123456789012',
    fullText: 'Multi-turn agentic workflows evaluation.',
    createdAt: 'Sat Oct 17 12:00:00 +0000 2026',
    replyCount: 210,
    retweetCount: 680,
    likeCount: 5400,
    viewCount: 280000,
    bookmarkCount: 620,
    isPinned: false,
    isRetweet: false,
    author: {
      userName: 'openai',
      name: 'OpenAI',
    },
    media: [
      { type: 'photo', url: 'https://pbs.twimg.com/photo1.jpg' },
      { type: 'photo', url: 'https://pbs.twimg.com/photo2.jpg' },
    ],
  },
];

class MockSearchProvider implements IScraperProvider {
  readonly providerName = 'mock_search_provider';
  public lastQuery = '';
  public lastMaxPosts = 0;

  constructor(private readonly posts: ScrapedPost[]) {}

  async scrapeProfile(_handle: string, maxPosts: number): Promise<ScrapedPost[]> {
    return this.posts.slice(0, maxPosts);
  }

  async searchTweets(query: string, maxPosts: number): Promise<ScrapedPost[]> {
    this.lastQuery = query;
    this.lastMaxPosts = maxPosts;
    return this.posts.slice(0, maxPosts);
  }
}

describe('ManagedApiNormalizer', () => {
  const normalizer = new ManagedApiNormalizer();

  it('normalizes TwitterAPI.io payload into ScrapedPost format', () => {
    const posts = normalizer.normalizeTwitterApiIo(sampleTwitterApiIoPayload);
    expect(posts.length).toBe(2);

    const first = posts[0];
    expect(first.id).toBe('1847321098492019482');
    expect(first.authorHandle).toBe('openai');
    expect(first.authorName).toBe('OpenAI');
    expect(first.metrics.likes).toBe(14890);
    expect(first.metrics.views).toBe(654200);
    expect(first.isPinned).toBe(true);
    expect(first.media.length).toBe(1);
    expect(first.media[0].type).toBe('photo');

    // Video variant highest bitrate check
    const second = posts[1];
    expect(second.media[0].type).toBe('video');
    expect(second.media[0].url).toBe('https://video.twimg.com/vid_high.mp4');
  });

  it('normalizes Apify payload into ScrapedPost format', () => {
    const posts = normalizer.normalizeApify(sampleApifyPayload);
    expect(posts.length).toBe(1);

    const post = posts[0];
    expect(post.id).toBe('1846987123456789012');
    expect(post.authorHandle).toBe('openai');
    expect(post.media.length).toBe(2);
    expect(post.text).toBe('Multi-turn agentic workflows evaluation.');
  });
});

describe('XScraperService - Batch Scraping', () => {
  const normalizer = new ManagedApiNormalizer();
  const mockPosts = normalizer.normalizeTwitterApiIo(sampleTwitterApiIoPayload);
  const mockProvider = new MockSearchProvider(mockPosts);

  const jsonExporter = new JsonExporter();
  const htmlExporter = new HtmlExporter();

  // Instantiate XScraperService injecting mock components
  const service = new XScraperService(
    mockProvider as unknown as any,
    undefined,
    jsonExporter,
    htmlExporter,
  );

  it('formats boolean batch query correctly and executes batch scraping', async () => {
    const result = await service.scrapeBatch({
      handles: ['AJArabic', 'AJEnglish', 'AlArabiya'],
      maxPosts: 10,
      feedName: 'test-batch',
    });

    expect(mockProvider.lastQuery).toBe('(from:AJArabic OR from:AJEnglish OR from:AlArabiya) -filter:replies');
    expect(mockProvider.lastMaxPosts).toBe(10);
    expect(result.handle).toBe('test-batch');
    expect(result.totalPosts).toBe(2);
    expect(result.posts.length).toBe(2);
  });

  it('exports standalone scrapeBatch helper function', async () => {
    const result = await scrapeBatch(service, {
      handles: ['AJArabic', 'AJEnglish'],
      maxPosts: 5,
      feedName: 'helper-test',
    });

    expect(result.handle).toBe('helper-test');
    expect(mockProvider.lastQuery).toBe('(from:AJArabic OR from:AJEnglish) -filter:replies');
  });

  it('exports scrapeBatchAndExport and creates valid files', async () => {
    const { result, exportedFiles } = await scrapeBatchAndExport(service, {
      handles: ['AJArabic'],
      maxPosts: 5,
      outputFormat: 'json',
      feedName: 'export-test',
    });

    expect(result.totalPosts).toBe(2);
    expect(exportedFiles.length).toBe(1);
    expect(exportedFiles[0]).toMatch(/export[-_]test\.json$/);
  });
});

describe('Timestamp Filtering Helpers', () => {
  it('parses Date object to milliseconds', () => {
    const d = new Date('2026-10-18T14:30:00.000Z');
    expect(parseSinceTimestamp(d)).toBe(d.getTime());
  });

  it('parses numeric epoch milliseconds', () => {
    const ms = 1792333800000;
    expect(parseSinceTimestamp(ms)).toBe(ms);
  });

  it('automatically converts epoch seconds to milliseconds', () => {
    const sec = 1792333800;
    expect(parseSinceTimestamp(sec)).toBe(sec * 1000);
  });

  it('parses ISO 8601 string', () => {
    const iso = '2026-10-18T14:30:00.000Z';
    expect(parseSinceTimestamp(iso)).toBe(Date.parse(iso));
  });

  it('parses date-only string', () => {
    const dateStr = '2026-10-18';
    expect(parseSinceTimestamp(dateStr)).toBe(Date.parse(dateStr));
  });

  it('parses numeric string in seconds or milliseconds', () => {
    expect(parseSinceTimestamp('1792333800')).toBe(1792333800000);
    expect(parseSinceTimestamp('1792333800000')).toBe(1792333800000);
  });

  it('throws on invalid date string or unsupported type', () => {
    expect(() => parseSinceTimestamp('invalid-date')).toThrow('Invalid date string');
    expect(() => parseSinceTimestamp('')).toThrow('Timestamp string cannot be empty');
    expect(() => parseSinceTimestamp(-1)).toThrow('Invalid numeric timestamp');
    expect(() => parseSinceTimestamp(new Date('invalid'))).toThrow('Invalid Date object');
    expect(() => parseSinceTimestamp({} as any)).toThrow('Unsupported timestamp type');
  });

  it('filterPostsByTimestamp retains only posts >= timestamp', () => {
    const normalizer = new ManagedApiNormalizer();
    const posts = normalizer.normalizeTwitterApiIo(sampleTwitterApiIoPayload);
    // Post 0: 2026-10-18T14:30:00.000Z
    // Post 1: 2026-10-17T18:00:00.000Z
    const cutoff = Date.parse('2026-10-18T00:00:00.000Z');
    const filtered = filterPostsByTimestamp(posts, cutoff);
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('1847321098492019482');
  });
});

describe('XScraperService - Timestamp Filtering', () => {
  const normalizer = new ManagedApiNormalizer();
  const mockPosts = normalizer.normalizeTwitterApiIo(sampleTwitterApiIoPayload);
  const mockProvider = new MockSearchProvider(mockPosts);
  const jsonExporter = new JsonExporter();
  const htmlExporter = new HtmlExporter();

  const service = new XScraperService(
    mockProvider as unknown as any,
    undefined,
    jsonExporter,
    htmlExporter,
  );

  it('filters posts from a specific timestamp and onwards in scrapeBatch (ISO string)', async () => {
    const result = await service.scrapeBatch({
      handles: ['AJArabic'],
      maxPosts: 10,
      feedName: 'since-test',
      since: '2026-10-18T00:00:00.000Z',
    });

    expect(result.totalPosts).toBe(1);
    expect(result.posts.length).toBe(1);
    expect(result.posts[0].id).toBe('1847321098492019482');
  });

  it('filters posts from a specific timestamp and onwards in scrapeBatch (Date object)', async () => {
    const result = await service.scrapeBatch({
      handles: ['AJArabic'],
      maxPosts: 10,
      since: new Date('2026-10-18T00:00:00.000Z'),
    });

    expect(result.totalPosts).toBe(1);
    expect(result.posts.length).toBe(1);
  });

  it('filters posts using sinceTimestamp alias', async () => {
    const result = await service.scrapeBatch({
      handles: ['AJArabic'],
      maxPosts: 10,
      sinceTimestamp: '2026-10-18T00:00:00.000Z',
    });

    expect(result.totalPosts).toBe(1);
    expect(result.posts.length).toBe(1);
  });

  it('returns all posts when timestamp is before all posts', async () => {
    const result = await service.scrapeBatch({
      handles: ['AJArabic'],
      maxPosts: 10,
      since: '2026-10-01T00:00:00.000Z',
    });

    expect(result.totalPosts).toBe(2);
    expect(result.posts.length).toBe(2);
  });

  it('returns 0 posts when timestamp is after all posts', async () => {
    const result = await service.scrapeBatch({
      handles: ['AJArabic'],
      maxPosts: 10,
      since: '2026-10-19T00:00:00.000Z',
    });

    expect(result.totalPosts).toBe(0);
    expect(result.posts.length).toBe(0);
  });

  it('supports timestamp filtering in scrapeProfile (positional arguments)', async () => {
    const result = await service.scrapeProfile('openai', 10, '2026-10-18T00:00:00.000Z');
    expect(result.totalPosts).toBe(1);
    expect(result.posts[0].id).toBe('1847321098492019482');
  });

  it('supports timestamp filtering in scrapeProfile (DTO argument)', async () => {
    const result = await service.scrapeProfile({
      handle: 'openai',
      maxPosts: 10,
      since: '2026-10-18T00:00:00.000Z',
    });
    expect(result.totalPosts).toBe(1);
    expect(result.posts[0].id).toBe('1847321098492019482');
  });

  it('supports timestamp filtering in searchTweets', async () => {
    const result = await service.searchTweets({
      query: 'openai',
      maxPosts: 10,
      since: '2026-10-18T00:00:00.000Z',
    });
    expect(result.totalPosts).toBe(1);
    expect(result.posts.length).toBe(1);
  });

  it('supports functional export scrapeProfile with timestamp', async () => {
    const result = await scrapeProfile(service, 'openai', 10, '2026-10-18T00:00:00.000Z');
    expect(result.totalPosts).toBe(1);
  });

  it('supports functional export searchTweets with timestamp', async () => {
    const result = await searchTweets(service, {
      query: 'openai',
      maxPosts: 10,
      since: '2026-10-18T00:00:00.000Z',
    });
    expect(result.totalPosts).toBe(1);
  });

  it('supports scrapeAndExport with timestamp filtering', async () => {
    const { result, exportedFiles } = await scrapeAndExport(service, {
      handle: 'openai',
      maxPosts: 5,
      outputFormat: 'json',
      since: '2026-10-18T00:00:00.000Z',
    });
    expect(result.totalPosts).toBe(1);
    expect(exportedFiles.length).toBe(1);
  });

  it('supports searchAndExport with timestamp filtering', async () => {
    const { result, exportedFiles } = await searchAndExport(service, {
      query: 'openai',
      name: 'search-export-test',
      maxPosts: 5,
      outputFormat: 'json',
      since: '2026-10-18T00:00:00.000Z',
    });
    expect(result.totalPosts).toBe(1);
    expect(exportedFiles.length).toBe(1);
  });

  it('filters posts and exports valid artifacts with scrapeBatchAndExport', async () => {
    const { result, exportedFiles } = await scrapeBatchAndExport(service, {
      handles: ['AJArabic'],
      maxPosts: 5,
      outputFormat: 'json',
      feedName: 'filtered-export',
      since: '2026-10-18T00:00:00.000Z',
    });

    expect(result.totalPosts).toBe(1);
    expect(result.posts.length).toBe(1);
    expect(exportedFiles.length).toBe(1);
  });

  it('throws error when invalid timestamp is provided in scrapeBatch', async () => {
    await expect(
      service.scrapeBatch({
        handles: ['AJArabic'],
        maxPosts: 10,
        since: 'not-a-valid-date',
      }),
    ).rejects.toThrow('Invalid date string for timestamp');
  });
});

describe('MONITORED_X_SOURCES', () => {
  it('contains verified OSINT channels with valid handles', () => {
    expect(MONITORED_X_SOURCES.length).toBe(83);
    for (const source of MONITORED_X_SOURCES) {
      expect(source.name).toBeTruthy();
      expect(source.handle).toBeTruthy();
      expect(source.handle.startsWith('@')).toBe(false);
      expect(source.category).toBeTruthy();
      expect(source.lang).toBeTruthy();
      expect(source.region).toBeTruthy();
    }
  });
});
