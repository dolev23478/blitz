import type {
  ProfileScrapeResult,
  ScrapedPost,
} from '../../../src/x-scraper/contracts/x-scraper.interfaces.js';

export function createMockScrapedPost(
  overrides?: Partial<ScrapedPost>,
): ScrapedPost {
  return {
    id: `post-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    url: 'https://x.com/mockuser/status/1234567890',
    authorHandle: 'mockuser',
    authorName: 'Mock User',
    authorAvatarUrl: 'https://pbs.twimg.com/avatar.jpg',
    text: 'Default test tweet content',
    publishedAt: new Date().toISOString(),
    metrics: { replies: 10, retweets: 5, likes: 50, views: 1000, bookmarks: 2 },
    media: [],
    isRetweet: false,
    isPinned: false,
    ...overrides,
  };
}

export function createMockBatchResult(
  overrides?: Partial<ProfileScrapeResult>,
): ProfileScrapeResult {
  const posts = overrides?.posts ?? [createMockScrapedPost()];
  return {
    handle: 'mock-batch-feed',
    scrapedAt: new Date().toISOString(),
    providerUsed: 'mock-provider (Search: "query...")',
    totalPosts: posts.length,
    posts,
    ...overrides,
  };
}
