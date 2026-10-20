export type OutputFormat = 'json' | 'html' | 'both';

export interface ScrapeRequestDto {
  handle: string;
  maxPosts: number;
  outputFormat?: OutputFormat;
  since?: string | number | Date;
  sinceTimestamp?: string | number | Date;
  fromTimestamp?: string | number | Date;
}

export interface SearchRequestDto {
  query: string;
  maxPosts?: number;
  outputFormat?: OutputFormat;
  name?: string;
  since?: string | number | Date;
  sinceTimestamp?: string | number | Date;
  fromTimestamp?: string | number | Date;
}

export interface BatchSourcesRequestDto {
  handles: string[];
  /** Maximum posts in the combined batch; defaults to 100 when omitted. */
  maxPosts?: number;
  outputFormat?: OutputFormat;
  queryFilter?: string;
  feedName?: string;
  since?: string | number | Date;
  sinceTimestamp?: string | number | Date;
  fromTimestamp?: string | number | Date;
}

export interface ScrapedPostMedia {
  type: 'photo' | 'video' | 'animated_gif';
  url: string;
  previewUrl?: string;
}

export interface ScrapedPost {
  id: string;
  url: string;
  authorHandle: string;
  authorName: string;
  authorAvatarUrl?: string;
  text: string;
  publishedAt: string;
  metrics: {
    replies: number;
    retweets: number;
    likes: number;
    views: number;
    bookmarks: number;
  };
  media: ScrapedPostMedia[];
  isRetweet: boolean;
  isPinned: boolean;
  rawHtmlSnippet?: string;
  matchedLanguage?: string;
}

export interface ProfileScrapeResult {
  handle: string;
  scrapedAt: string;
  providerUsed: string;
  totalPosts: number;
  posts: ScrapedPost[];
}

export interface IScraperProvider {
  readonly providerName: string;
  scrapeProfile(handle: string, maxPosts: number, sinceTimestamp?: number): Promise<ScrapedPost[]>;
  searchTweets?(query: string, maxPosts: number, sinceTimestamp?: number): Promise<ScrapedPost[]>;
}

export interface IPostExporter {
  export(result: ProfileScrapeResult, outputDir: string): Promise<string>;
}
