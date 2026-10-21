import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MONITORED_X_SOURCES } from './constants/monitored-sources.js';
import type { ProfileScrapeResult } from './contracts/x-scraper.interfaces.js';
import { XScraperService } from './x-scraper.service.js';
import { RedisService } from '../redis/redis.service.js';
import { analyzeText } from '../text-analyzer.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';
import { KafkaAnalyticsService } from '../analytics/kafka-analytics.service.js';

@Injectable()
export class XScraperCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(XScraperCronService.name);
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    @Inject(XScraperService) private readonly xScraper: XScraperService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TransformerWorkflow) private readonly transformer: TransformerWorkflow,
    @Optional() @Inject(KafkaAnalyticsService) private readonly analytics?: KafkaAnalyticsService,
  ) {}

  onModuleInit(): void {
    this.intervalId = setInterval(() => {
      void this.runCycle();
    }, 5 * 60 * 1000);

    void this.runCycle();
  }

  onModuleDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async runCycle(): Promise<void> {
    try {
      const handles = MONITORED_X_SOURCES.map((source) => source.handle);

      if (handles.length === 0) {
        this.logger.warn('No monitored X sources configured.');
        return;
      }

      const lastScrapeAt = this.redis.isEnabled() ? await this.redis.get('x:last-scrape-at') : null;
      const since = lastScrapeAt ? new Date(lastScrapeAt) : new Date(Date.now() - 24 * 60 * 60 * 1000);

      this.logger.log(`Running X scraper cycle for ${handles.length} handles since ${since.toISOString()}`);
      const result = await this.xScraper.scrapeBatch({
        handles,
        since,
        queryFilter: '-filter:replies',
        feedName: 'x-monitor',
      });

      this.logger.log(
        `X cycle finished: handle=${result.handle}, totalPosts=${result.totalPosts}, provider=${result.providerUsed}`,
      );

      await this.onXResult(result, since);
    } catch (err) {
      this.logger.error(`X scraper cycle failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Called automatically every time the cron cycle gets a result from X.
   * Advances the last-scrape timestamp only when all matching posts were accepted by the transformer.
   */
  private async onXResult(result: ProfileScrapeResult, startedAt: Date): Promise<void> {
    const cursor = startedAt.toISOString();
    const keptPosts: Array<(typeof result.posts)[number]> = [];

    for (const post of result.posts) {
      if (!post.text || !post.text.trim()) continue;

      const analysis = analyzeText(post.text, 'auto');
      if (!analysis.matched) {
        this.analytics?.recordRejected({
          id: post.id || randomUUID(),
          channel: result.handle,
          source: 'x',
          content: post.text,
          reason: 'Keyword filter rejected: did not match any threat terms',
          attemptedLanguages: ['auto'],
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const matchedLanguage = analysis.languages?.[0] ?? analysis.language ?? null;
      if (!matchedLanguage) {
        this.analytics?.recordRejected({
          id: post.id || randomUUID(),
          channel: result.handle,
          source: 'x',
          content: post.text,
          reason: 'Keyword filter rejected: no matching language identified',
          attemptedLanguages: ['auto'],
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      this.logger.log(
        `X language match: lang=${matchedLanguage}, terms=${analysis.terms.join(', ') || 'none'}, text=${post.text.slice(0, 120)}`,
      );

      post.language = matchedLanguage;
      post.matches = analysis.terms;
      keptPosts.push(post);
    }

    if (!keptPosts.length) {
      if (this.redis.isEnabled()) {
        await this.redis.set('x:last-scrape-at', cursor);
      }
      this.logger.log(`X result ready: 0 posts from ${result.handle}; saved timestamp=${cursor}`);
      return;
    }

    let failed = 0;
    for (const post of keptPosts) {
      const singleResult: ProfileScrapeResult = {
        ...result,
        totalPosts: 1,
        posts: [post],
      };
      try {
        await this.transformer.run('ProfileScrapeResult', singleResult, {
          language: post.language,
          matches: post.matches,
          collectedAt: new Date().toISOString(),
          source: 'x',
        });
      } catch (err) {
        failed++;
        this.logger.error(
          `X post failed: ${post.url}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Only advance the cursor once every post was handed over, so a failed cycle re-pulls it next time.
    if (failed) {
      this.logger.warn(`X result: ${failed}/${keptPosts.length} posts failed from ${result.handle}; cursor not advanced`);
      return;
    }

    if (this.redis.isEnabled()) {
      await this.redis.set('x:last-scrape-at', cursor);
    }

    this.logger.log(`X result ready: ${keptPosts.length} posts from ${result.handle}; saved timestamp=${cursor}`);
  }
}
