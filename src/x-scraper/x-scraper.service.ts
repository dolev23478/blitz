import { Injectable, Optional } from '@nestjs/common';
import type {
  IScraperProvider,
  ScrapeRequestDto,
  SearchRequestDto,
  BatchSourcesRequestDto,
  ProfileScrapeResult,
  ScrapedPost,
  OutputFormat,
} from './contracts/x-scraper.interfaces.js';
import { TwitterApiIoProvider } from './providers/twitterapi-io.provider.js';
import { ApifyXProvider } from './providers/apify-x.provider.js';
import { JsonExporter } from './exporters/json.exporter.js';
import { HtmlExporter } from './exporters/html.exporter.js';

@Injectable()
export class XScraperService {
  private readonly defaultProvider: IScraperProvider;
  private readonly twitterProvider: TwitterApiIoProvider;
  private readonly apifyProvider: ApifyXProvider;
  private readonly jsonExporter: JsonExporter;
  private readonly htmlExporter: HtmlExporter;
  private readonly outputDir: string;

  constructor(
    @Optional() twitterProvider?: TwitterApiIoProvider,
    @Optional() apifyProvider?: ApifyXProvider,
    @Optional() jsonExporter?: JsonExporter,
    @Optional() htmlExporter?: HtmlExporter,
  ) {
    this.twitterProvider = twitterProvider ?? new TwitterApiIoProvider();
    this.apifyProvider = apifyProvider ?? new ApifyXProvider();
    this.jsonExporter = jsonExporter ?? new JsonExporter();
    this.htmlExporter = htmlExporter ?? new HtmlExporter();

    const chosenProvider = (process.env.SCRAPER_PROVIDER || 'twitterapi_io').toLowerCase();
    this.defaultProvider = chosenProvider.includes('apify') ? this.apifyProvider : this.twitterProvider;
    this.outputDir = process.env.OUTPUT_DIR || './output';
  }

  /**
   * Batches multiple user handles into a single Boolean search query ("from:A OR from:B")
   * to fetch unified chronological posts in a single HTTP request (Option A).
   * Optionally filters posts from a specific timestamp onwards.
   */
  public async scrapeBatch(dto: BatchSourcesRequestDto): Promise<ProfileScrapeResult> {
    const cleanHandles = (dto.handles || [])
      .map((h) => h.replace(/^@/, '').trim())
      .filter((h) => h.length > 0);

    if (cleanHandles.length === 0) {
      throw new Error('Batch handles list must contain at least one non-empty handle');
    }

    const filter = dto.queryFilter !== undefined ? dto.queryFilter.trim() : '-filter:replies';
    const since = dto.since ?? dto.sinceTimestamp ?? dto.fromTimestamp;
    const name = dto.feedName || 'osint-network';

    // twitterapi.io rejects queries over 512 characters, so split the handles across several queries.
    const results: ProfileScrapeResult[] = [];
    for (const [index, chunk] of chunkHandlesForQuery(cleanHandles, filter).entries()) {
      if (index > 0) await new Promise((r) => setTimeout(r, QUERY_DELAY_MS));
      const fromClause = chunk.map((h) => `from:${h}`).join(' OR ');
      const query = filter ? `(${fromClause}) ${filter}` : `(${fromClause})`;
      results.push(await this.searchTweets({ query, maxPosts: dto.maxPosts ?? 100, name, since }));
    }
    if (results.length === 1) return results[0]!;

    const posts = results
      .flatMap((r) => r.posts)
      .sort((a, b) => Date.parse(a.publishedAt ?? '') - Date.parse(b.publishedAt ?? ''));
    return { ...results[0]!, scrapedAt: new Date().toISOString(), totalPosts: posts.length, posts };
  }

  /**
   * Batches multiple user handles into a single Boolean search query, fetches posts,
   * and exports them into JSON and/or HTML reports.
   */
  public async scrapeBatchAndExport(
    dto: BatchSourcesRequestDto,
  ): Promise<{ result: ProfileScrapeResult; exportedFiles: string[] }> {
    const result = await this.scrapeBatch(dto);
    const format: OutputFormat = dto.outputFormat || 'both';
    const exportedFiles = await this.exportArtifacts(result, format);
    return { result, exportedFiles };
  }

  /**
   * Scrapes tweets from a single Twitter user profile.
   * Supports passing (handle, maxPosts, since?) or a single ScrapeRequestDto object.
   * When since / sinceTimestamp is provided, only posts from that timestamp and onwards are returned.
   */
  public async scrapeProfile(
    handleOrDto: string | ScrapeRequestDto,
    maxPosts?: number,
    since?: string | number | Date,
  ): Promise<ProfileScrapeResult> {
    let cleanHandle: string;
    let resolvedMaxPosts: number;
    let rawSince: string | number | Date | undefined;

    if (typeof handleOrDto === 'object' && handleOrDto !== null) {
      cleanHandle = handleOrDto.handle ? handleOrDto.handle.replace(/^@/, '').trim() : '';
      resolvedMaxPosts = handleOrDto.maxPosts;
      rawSince = handleOrDto.since ?? handleOrDto.sinceTimestamp ?? handleOrDto.fromTimestamp;
    } else {
      cleanHandle = handleOrDto ? handleOrDto.replace(/^@/, '').trim() : '';
      resolvedMaxPosts = maxPosts ?? 0;
      rawSince = since;
    }

    if (!cleanHandle) {
      throw new Error('Twitter handle must be a non-empty string');
    }

    if (resolvedMaxPosts <= 0) {
      throw new Error('maxPosts must be greater than 0');
    }

    const sinceTimestamp = rawSince !== undefined ? parseSinceTimestamp(rawSince) : undefined;
    const rawPosts = await this.defaultProvider.scrapeProfile(
      cleanHandle,
      resolvedMaxPosts,
      sinceTimestamp,
    );
    const posts = sinceTimestamp !== undefined
      ? filterPostsByTimestamp(rawPosts, sinceTimestamp)
      : rawPosts;

    return {
      handle: cleanHandle,
      scrapedAt: new Date().toISOString(),
      providerUsed: this.defaultProvider.providerName,
      totalPosts: posts.length,
      posts,
    };
  }

  /**
   * Scrapes and exports tweets from a single Twitter user profile.
   */
  public async scrapeAndExport(
    dto: ScrapeRequestDto,
  ): Promise<{ result: ProfileScrapeResult; exportedFiles: string[] }> {
    const result = await this.scrapeProfile(dto);
    const format: OutputFormat = dto.outputFormat || 'both';
    const exportedFiles = await this.exportArtifacts(result, format);
    return { result, exportedFiles };
  }

  /**
   * Scrapes tweets using an advanced search query.
   * When since / sinceTimestamp is provided, only posts from that timestamp and onwards are returned.
   */
  public async searchTweets(dto: SearchRequestDto): Promise<ProfileScrapeResult> {
    const cleanQuery = dto.query ? dto.query.trim() : '';

    if (!cleanQuery) {
      throw new Error('Search query must be a non-empty string');
    }

    if (!dto.maxPosts || dto.maxPosts <= 0) {
      throw new Error('maxPosts must be greater than 0');
    }

    if (!this.defaultProvider.searchTweets) {
      throw new Error(
        `Provider '${this.defaultProvider.providerName}' does not support search queries.`,
      );
    }

    const rawSince = dto.since ?? dto.sinceTimestamp ?? dto.fromTimestamp;
    const sinceTimestamp = rawSince !== undefined ? parseSinceTimestamp(rawSince) : undefined;

    const rawPosts = await this.defaultProvider.searchTweets(
      cleanQuery,
      dto.maxPosts,
      sinceTimestamp,
    );
    const posts = sinceTimestamp !== undefined
      ? filterPostsByTimestamp(rawPosts, sinceTimestamp)
      : rawPosts;
    const targetName = dto.name ? dto.name.replace(/^@/, '').trim() : 'search-results';

    return {
      handle: targetName,
      scrapedAt: new Date().toISOString(),
      providerUsed: `${this.defaultProvider.providerName} (Search: "${cleanQuery.slice(0, 40)}...")`,
      totalPosts: posts.length,
      posts,
    };
  }

  /**
   * Scrapes and exports tweets using an advanced search query.
   */
  public async searchAndExport(
    dto: SearchRequestDto,
  ): Promise<{ result: ProfileScrapeResult; exportedFiles: string[] }> {
    const result = await this.searchTweets(dto);
    const format: OutputFormat = dto.outputFormat || 'both';
    const exportedFiles = await this.exportArtifacts(result, format);
    return { result, exportedFiles };
  }

  private async exportArtifacts(
    result: ProfileScrapeResult,
    outputFormat: OutputFormat,
  ): Promise<string[]> {
    const exportedFiles: string[] = [];

    if (outputFormat === 'json' || outputFormat === 'both') {
      const jsonPath = await this.jsonExporter.export(result, this.outputDir);
      exportedFiles.push(jsonPath);
    }

    if (outputFormat === 'html' || outputFormat === 'both') {
      const htmlPath = await this.htmlExporter.export(result, this.outputDir);
      exportedFiles.push(htmlPath);
    }

    return exportedFiles;
  }
}

const MAX_QUERY_LENGTH = 500;
/** twitterapi.io rate-limits to about one request per 5s on low tiers; pace the chunked queries accordingly. */
const QUERY_DELAY_MS = Number(process.env.X_QUERY_DELAY_MS ?? 5500);

/** Groups handles so that each "(from:A OR from:B) <filter>" query stays within the API length limit. */
export function chunkHandlesForQuery(handles: string[], filter: string): string[][] {
  const overhead = filter.length + 4; // parentheses, space and slack
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = overhead;
  for (const handle of handles) {
    const added = `from:${handle}`.length + (current.length ? 4 : 0);
    if (current.length && length + added > MAX_QUERY_LENGTH) {
      chunks.push(current);
      current = [];
      length = overhead;
    }
    length += `from:${handle}`.length + (current.length ? 4 : 0);
    current.push(handle);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Parses and validates a timestamp representation into epoch milliseconds.
 * Supports Date objects, numeric epoch ms or epoch seconds, and ISO/date strings.
 */
export function parseSinceTimestamp(since: string | number | Date): number {
  if (since instanceof Date) {
    const time = since.getTime();
    if (isNaN(time)) {
      throw new Error('Invalid Date object provided as timestamp filter');
    }
    return time;
  }

  if (typeof since === 'number') {
    if (isNaN(since) || !isFinite(since) || since < 0) {
      throw new Error(`Invalid numeric timestamp: ${since}`);
    }
    // If value is in seconds range (< 100 billion), convert to milliseconds
    return since < 100_000_000_000 ? Math.floor(since * 1000) : Math.floor(since);
  }

  if (typeof since === 'string') {
    const trimmed = since.trim();
    if (!trimmed) {
      throw new Error('Timestamp string cannot be empty');
    }

    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (!isNaN(num) && isFinite(num) && num >= 0) {
        return num < 100_000_000_000 ? Math.floor(num * 1000) : Math.floor(num);
      }
    }

    const parsed = Date.parse(trimmed);
    if (isNaN(parsed)) {
      throw new Error(`Invalid date string for timestamp: "${since}"`);
    }
    return parsed;
  }

  throw new Error(`Unsupported timestamp type: ${typeof since}`);
}

/**
 * Filters scraped posts to retain only posts published at or after the given timestamp.
 */
export function filterPostsByTimestamp(
  posts: ScrapedPost[],
  sinceTimestampMs: number,
): ScrapedPost[] {
  return posts.filter((post) => {
    if (!post.publishedAt) {
      return false;
    }
    const postTime = Date.parse(post.publishedAt);
    return !isNaN(postTime) && postTime >= sinceTimestampMs;
  });
}

/**
 * Direct functional export of the batch scraping function.
 */
export async function scrapeBatch(
  service: XScraperService,
  dto: BatchSourcesRequestDto,
): Promise<ProfileScrapeResult> {
  return service.scrapeBatch(dto);
}

/**
 * Direct functional export of the batch scraping and export function.
 */
export async function scrapeBatchAndExport(
  service: XScraperService,
  dto: BatchSourcesRequestDto,
): Promise<{ result: ProfileScrapeResult; exportedFiles: string[] }> {
  return service.scrapeBatchAndExport(dto);
}

/**
 * Direct functional export of the profile scraping function.
 */
export async function scrapeProfile(
  service: XScraperService,
  handleOrDto: string | ScrapeRequestDto,
  maxPosts?: number,
  since?: string | number | Date,
): Promise<ProfileScrapeResult> {
  return service.scrapeProfile(handleOrDto as any, maxPosts as any, since);
}

/**
 * Direct functional export of the profile scraping and export function.
 */
export async function scrapeAndExport(
  service: XScraperService,
  dto: ScrapeRequestDto,
): Promise<{ result: ProfileScrapeResult; exportedFiles: string[] }> {
  return service.scrapeAndExport(dto);
}

/**
 * Direct functional export of the search scraping function.
 */
export async function searchTweets(
  service: XScraperService,
  dto: SearchRequestDto,
): Promise<ProfileScrapeResult> {
  return service.searchTweets(dto);
}

/**
 * Direct functional export of the search and export function.
 */
export async function searchAndExport(
  service: XScraperService,
  dto: SearchRequestDto,
): Promise<{ result: ProfileScrapeResult; exportedFiles: string[] }> {
  return service.searchAndExport(dto);
}

export default XScraperService;
