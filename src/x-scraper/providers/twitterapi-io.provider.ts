import { Injectable, Optional } from '@nestjs/common';
import type { IScraperProvider, ScrapedPost } from '../contracts/x-scraper.interfaces.js';
import { ManagedApiNormalizer } from '../parsers/managed-api.normalizer.js';

function extractNextCursor(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;

  if (typeof record.next_cursor === 'string' && record.next_cursor.trim().length > 0) {
    return record.next_cursor.trim();
  }
  if (typeof record.cursor === 'string' && record.cursor.trim().length > 0) {
    return record.cursor.trim();
  }

  if (typeof record.data === 'object' && record.data !== null) {
    const dataRecord = record.data as Record<string, unknown>;
    if (typeof dataRecord.next_cursor === 'string' && dataRecord.next_cursor.trim().length > 0) {
      return dataRecord.next_cursor.trim();
    }
    if (typeof dataRecord.cursor === 'string' && dataRecord.cursor.trim().length > 0) {
      return dataRecord.cursor.trim();
    }
  }

  return undefined;
}

function extractHasNextPage(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;

  if (typeof record.has_next_page === 'boolean') {
    return record.has_next_page;
  }

  if (typeof record.data === 'object' && record.data !== null) {
    const dataRecord = record.data as Record<string, unknown>;
    if (typeof dataRecord.has_next_page === 'boolean') {
      return dataRecord.has_next_page;
    }
  }

  return false;
}

/**
 * Executes fetch with automatic retry on 429 Too Many Requests (QPS limit).
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  retryDelayMs = 5500,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt++;
    const response = await fetch(url, options);

    if (response.status === 429 && attempt <= maxRetries) {
      console.warn(
        `[TwitterApiIoProvider] Rate limited (429 Too Many Requests). Waiting ${retryDelayMs / 1000}s before retry (attempt ${attempt}/${maxRetries})...`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }

    return response;
  }
}

@Injectable()
export class TwitterApiIoProvider implements IScraperProvider {
  readonly providerName: string = 'twitterapi_io';
  private readonly normalizer: ManagedApiNormalizer;

  constructor(@Optional() normalizer?: ManagedApiNormalizer) {
    this.normalizer = normalizer ?? new ManagedApiNormalizer();
  }

  private getApiKey(): string {
    return process.env.TWITTERAPI_IO_KEY?.trim() || '';
  }

  private getBaseUrl(): string {
    const raw = process.env.TWITTERAPI_IO_BASE_URL?.trim() || 'https://api.twitterapi.io';
    return raw.replace(/\/+$/, '');
  }

  private getTimeoutMs(): number {
    const raw = process.env.HTTP_TIMEOUT_MS;
    const parsed = raw ? parseInt(raw, 10) : 30000;
    return isNaN(parsed) || parsed <= 0 ? 30000 : parsed;
  }

  /**
   * Scrapes the most recent tweets from a single Twitter user profile.
   */
  public async scrapeProfile(
    handle: string,
    maxPosts: number,
    sinceTimestamp?: number,
  ): Promise<ScrapedPost[]> {
    if (!handle || typeof handle !== 'string') {
      throw new Error('Twitter handle must be a non-empty string');
    }

    const cleanHandle = handle.replace(/^@+/, '').trim();
    if (!cleanHandle) {
      throw new Error('Twitter handle must be a non-empty string');
    }

    if (maxPosts <= 0) {
      return [];
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('TwitterAPI.io API key is not configured in TWITTERAPI_IO_KEY');
    }

    const baseUrl = this.getBaseUrl();
    const timeoutMs = this.getTimeoutMs();
    const collectedPosts: ScrapedPost[] = [];
    const seenPostIds = new Set<string>();
    let cursor: string | undefined = undefined;

    while (collectedPosts.length < maxPosts) {
      const url = new URL(`${baseUrl}/twitter/user/last_tweets`);
      url.searchParams.set('userName', cleanHandle);
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const response = await fetchWithRetry(
        url.toString(),
        {
          method: 'GET',
          headers: {
            'X-API-Key': apiKey,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(timeoutMs),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `TwitterAPI.io request failed with status ${response.status} (${response.statusText}): ${errorText}`,
        );
      }

      const payload: unknown = await response.json();

      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        if (record.status === 'error') {
          const message =
            (typeof record.msg === 'string' && record.msg) ||
            (typeof record.message === 'string' && record.message) ||
            'API returned error status';
          throw new Error(`TwitterAPI.io error: ${message}`);
        }
      }

      const normalized = this.normalizer.normalizeTwitterApiIo(payload);
      if (normalized.length === 0) {
        break;
      }

      let newItemsAdded = 0;
      let reachedOlderThanSince = false;

      for (const post of normalized) {
        if (!seenPostIds.has(post.id)) {
          seenPostIds.add(post.id);

          const postTime = post.publishedAt ? Date.parse(post.publishedAt) : NaN;
          if (sinceTimestamp !== undefined && !isNaN(postTime)) {
            if (postTime < sinceTimestamp) {
              if (!post.isPinned) {
                reachedOlderThanSince = true;
              }
              continue;
            }
          }

          collectedPosts.push(post);
          newItemsAdded++;

          if (collectedPosts.length >= maxPosts) {
            break;
          }
        }
      }

      if (collectedPosts.length >= maxPosts || newItemsAdded === 0 || reachedOlderThanSince) {
        break;
      }

      const nextCursor = extractNextCursor(payload);
      const hasNextPage = extractHasNextPage(payload);

      if (!nextCursor || (!hasNextPage && nextCursor === cursor) || nextCursor === cursor) {
        break;
      }

      cursor = nextCursor;

      // Rate limit protection: 1 request every 5 seconds on standard tier
      if (collectedPosts.length < maxPosts) {
        await new Promise((resolve) => setTimeout(resolve, 5200));
      }
    }

    return collectedPosts.slice(0, maxPosts);
  }

  /**
   * Scrapes tweets matching an advanced search query using X Boolean operators.
   * Enables batching multiple profiles (e.g. "from:A OR from:B") in a single request.
   */
  public async searchTweets(
    query: string,
    maxPosts: number,
    sinceTimestamp?: number,
  ): Promise<ScrapedPost[]> {
    if (!query || typeof query !== 'string') {
      throw new Error('Search query must be a non-empty string');
    }

    const cleanQuery = query.trim();
    if (!cleanQuery) {
      throw new Error('Search query must be a non-empty string');
    }

    if (maxPosts <= 0) {
      return [];
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('TwitterAPI.io API key is not configured in TWITTERAPI_IO_KEY');
    }

    const baseUrl = this.getBaseUrl();
    const timeoutMs = this.getTimeoutMs();
    const collectedPosts: ScrapedPost[] = [];
    const seenPostIds = new Set<string>();
    let cursor: string | undefined = undefined;

    while (collectedPosts.length < maxPosts) {
      const url = new URL(`${baseUrl}/twitter/tweet/advanced_search`);
      url.searchParams.set('query', cleanQuery);
      url.searchParams.set('queryType', 'Latest');
      if (cursor) {
        url.searchParams.set('cursor', cursor);
      }

      const response = await fetchWithRetry(
        url.toString(),
        {
          method: 'GET',
          headers: {
            'X-API-Key': apiKey,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(timeoutMs),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(
          `TwitterAPI.io search request failed with status ${response.status} (${response.statusText}): ${errorText}`,
        );
      }

      const payload: unknown = await response.json();

      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        if (record.status === 'error') {
          const message =
            (typeof record.msg === 'string' && record.msg) ||
            (typeof record.message === 'string' && record.message) ||
            'API returned error status';
          throw new Error(`TwitterAPI.io error: ${message}`);
        }
      }

      const normalized = this.normalizer.normalizeTwitterApiIo(payload);
      if (normalized.length === 0) {
        break;
      }

      let newItemsAdded = 0;
      let reachedOlderThanSince = false;

      for (const post of normalized) {
        if (!seenPostIds.has(post.id)) {
          seenPostIds.add(post.id);

          const postTime = post.publishedAt ? Date.parse(post.publishedAt) : NaN;
          if (sinceTimestamp !== undefined && !isNaN(postTime)) {
            if (postTime < sinceTimestamp) {
              if (!post.isPinned) {
                reachedOlderThanSince = true;
              }
              continue;
            }
          }

          collectedPosts.push(post);
          newItemsAdded++;

          if (collectedPosts.length >= maxPosts) {
            break;
          }
        }
      }

      if (collectedPosts.length >= maxPosts || newItemsAdded === 0 || reachedOlderThanSince) {
        break;
      }

      const nextCursor = extractNextCursor(payload);
      const hasNextPage = extractHasNextPage(payload);

      if (!nextCursor || (!hasNextPage && nextCursor === cursor) || nextCursor === cursor) {
        break;
      }

      cursor = nextCursor;

      // Rate limit protection: 1 request every 5 seconds on standard tier
      if (collectedPosts.length < maxPosts) {
        await new Promise((resolve) => setTimeout(resolve, 5200));
      }
    }

    return collectedPosts.slice(0, maxPosts);
  }
}

export default TwitterApiIoProvider;
