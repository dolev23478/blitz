import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

export interface FetchResult {
  html: string;
  finalUrl: string;
}

@Injectable()
export class HttpClientService {
  private lastRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Serializes requests so at least REQUEST_DELAY_MS passes between any two of them. */
  private throttle(): Promise<void> {
    const next = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.config.REQUEST_DELAY_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async fetchHtml(url: string, retries = 3): Promise<FetchResult> {
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return { html: await res.text(), finalUrl: res.url };
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= retries) throw new HttpError(res.status, url);
        const retryAfter = Number(res.headers.get('retry-after')) * 1000;
        await sleep(retryAfter || 2000 * 2 ** attempt);
      } catch (err) {
        if (err instanceof HttpError || attempt >= retries) throw err;
        await sleep(2000 * 2 ** attempt);
      }
    }
  }
}
