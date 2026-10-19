import { Injectable, Optional } from '@nestjs/common';
import type {
  IScraperProvider,
  ScrapeRequestDto,
  SearchRequestDto,
  BatchSourcesRequestDto,
  ProfileScrapeResult,
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
   */
  public async scrapeBatch(dto: BatchSourcesRequestDto): Promise<ProfileScrapeResult> {
    const cleanHandles = (dto.handles || [])
      .map((h) => h.replace(/^@/, '').trim())
      .filter((h) => h.length > 0);

    if (cleanHandles.length === 0) {
      throw new Error('Batch handles list must contain at least one non-empty handle');
    }

    const fromClause = cleanHandles.map((h) => `from:${h}`).join(' OR ');
    const filter = dto.queryFilter !== undefined ? dto.queryFilter.trim() : '-filter:replies';
    const query = filter ? `(${fromClause}) ${filter}` : `(${fromClause})`;

    return this.searchTweets({
      query,
      maxPosts: dto.maxPosts,
      name: dto.feedName || 'osint-network',
    });
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
   */
  public async scrapeProfile(handle: string, maxPosts: number): Promise<ProfileScrapeResult> {
    const cleanHandle = handle ? handle.replace(/^@/, '').trim() : '';

    if (!cleanHandle) {
      throw new Error('Twitter handle must be a non-empty string');
    }

    if (maxPosts <= 0) {
      throw new Error('maxPosts must be greater than 0');
    }

    const posts = await this.defaultProvider.scrapeProfile(cleanHandle, maxPosts);

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
    const result = await this.scrapeProfile(dto.handle, dto.maxPosts);
    const format: OutputFormat = dto.outputFormat || 'both';
    const exportedFiles = await this.exportArtifacts(result, format);
    return { result, exportedFiles };
  }

  /**
   * Scrapes tweets using an advanced search query.
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

    const posts = await this.defaultProvider.searchTweets(cleanQuery, dto.maxPosts);
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

export default XScraperService;
