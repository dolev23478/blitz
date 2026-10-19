import { describe, expect, it } from 'vitest';
import { ManagedApiNormalizer } from '../src/x-scraper/parsers/managed-api.normalizer.js';
import { JsonExporter } from '../src/x-scraper/exporters/json.exporter.js';
import { HtmlExporter } from '../src/x-scraper/exporters/html.exporter.js';
import {
  XScraperService,
  scrapeBatch,
  scrapeBatchAndExport,
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
    expect(exportedFiles[0].endsWith('export_test.json')).toBe(true);
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
