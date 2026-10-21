import { Logger } from '@nestjs/common';
import { afterEach, expect, it, vi } from 'vitest';
import { FilteredPostsService } from '../src/events/filtered-posts.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { TransformerWorkflow } from '../src/transformer/transformer.workflow.js';
import { XScraperCronService } from '../src/x-scraper/x-scraper.cron.service.js';
import { XScraperService } from '../src/x-scraper/x-scraper.service.js';
import type { ProfileScrapeResult } from '../src/x-scraper/contracts/x-scraper.interfaces.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(['success', 'failure'])(
  'does not overlap X polling and resumes after a pending %s',
  async (outcome) => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    let finish!: (result: ProfileScrapeResult) => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<ProfileScrapeResult>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const result: ProfileScrapeResult = {
      handle: 'test',
      scrapedAt: new Date().toISOString(),
      providerUsed: 'test',
      totalPosts: 0,
      posts: [],
    };
    const scrapeBatch = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockResolvedValue(result);
    const service = new XScraperCronService(
      { scrapeBatch } as unknown as XScraperService,
      { isEnabled: () => false } as RedisService,
      {} as TransformerWorkflow,
      new FilteredPostsService(),
    );
    try {
      service.onModuleInit();
      expect(scrapeBatch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(scrapeBatch).toHaveBeenCalledTimes(1);
      if (outcome === 'success') finish(result);
      else fail(new Error('Provider unavailable'));
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(scrapeBatch).toHaveBeenCalledTimes(2);
      service.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(scrapeBatch).toHaveBeenCalledTimes(2);
    } finally {
      service.onModuleDestroy();
    }
  },
);
