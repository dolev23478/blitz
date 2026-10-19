import { Injectable, Optional } from '@nestjs/common';
import type { IScraperProvider, ScrapedPost } from '../contracts/x-scraper.interfaces.js';
import { ManagedApiNormalizer } from '../parsers/managed-api.normalizer.js';

@Injectable()
export class ApifyXProvider implements IScraperProvider {
  readonly providerName: string = 'apify';
  private readonly normalizer: ManagedApiNormalizer;

  constructor(@Optional() normalizer?: ManagedApiNormalizer) {
    this.normalizer = normalizer ?? new ManagedApiNormalizer();
  }

  private getApiToken(): string {
    return process.env.APIFY_API_TOKEN?.trim() || '';
  }

  private getActorId(): string {
    return (process.env.APIFY_ACTOR_ID?.trim() || 'apidojo~tweet-scraper').replace('/', '~');
  }

  private getTimeoutMs(): number {
    const raw = process.env.HTTP_TIMEOUT_MS;
    const parsed = raw ? parseInt(raw, 10) : 30000;
    return isNaN(parsed) || parsed <= 0 ? 30000 : parsed;
  }

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

    const token = this.getApiToken();
    if (!token) {
      throw new Error('Apify API token is not configured in APIFY_API_TOKEN');
    }

    const actorId = this.getActorId();
    const timeoutMs = this.getTimeoutMs();
    const url = new URL(`https://api.apify.com/v2/actors/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`);
    url.searchParams.set('token', token);

    const requestBody = {
      twitterHandles: [cleanHandle],
      maxItems: maxPosts,
      sort: 'Latest',
    };

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `Apify request failed with status ${response.status} (${response.statusText}): ${errorText}`,
      );
    }

    const payload: unknown = await response.json();

    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      if (record.error && typeof record.error === 'object') {
        const errorObj = record.error as Record<string, unknown>;
        const message = typeof errorObj.message === 'string' ? errorObj.message : JSON.stringify(record.error);
        throw new Error(`Apify error: ${message}`);
      }
    }

    let posts = this.normalizer.normalizeApify(payload);
    if (sinceTimestamp !== undefined) {
      posts = posts.filter((post) => {
        const postTime = post.publishedAt ? Date.parse(post.publishedAt) : NaN;
        return !isNaN(postTime) && postTime >= sinceTimestamp;
      });
    }
    return posts.slice(0, maxPosts);
  }
}

export default ApifyXProvider;
