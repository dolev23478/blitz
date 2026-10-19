import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MONITORED_X_SOURCES } from './constants/monitored-sources.js';
import type { ProfileScrapeResult } from './contracts/x-scraper.interfaces.js';
import { XScraperService } from './x-scraper.service.js';
import { RedisService } from '../redis/redis.service.js';
import { analyzeText } from '../text-analyzer.js';
import { getDictionaryStore } from '../dictionaries/load-dictionaries.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';

@Injectable()
export class XScraperCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(XScraperCronService.name);
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly xScraper: XScraperService,
    private readonly redis: RedisService,
    private readonly transformer: TransformerWorkflow,
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

      await this.onXResult(result);
    } catch (err) {
      this.logger.error(`X scraper cycle failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Called automatically every time the cron cycle gets a result from X. */
  private async onXResult(result: ProfileScrapeResult): Promise<void> {
    const now = new Date().toISOString();

    if (this.redis.isEnabled()) {
      await this.redis.set('x:last-scrape-at', now);
    }

    const supportedLanguages = getDictionaryStore().languages();
    const keptPosts: Array<(typeof result.posts)[number] & { matchedLanguage?: string; language?: string }> = [];

    for (const post of result.posts) {
      if (!post.text || !post.text.trim()) continue;

      let matchedLanguage: string | null = null;
      for (const language of supportedLanguages) {
        const analysis = analyzeText(post.text, language);
        if (analysis.matched) {
          matchedLanguage = language;
          this.logger.log(
            `X language match: lang=${language}, terms=${analysis.terms.join(', ') || 'none'}, text=${post.text.slice(0, 120)}`,
          );
          break;
        }
      }

      if (matchedLanguage) {
        keptPosts.push({
          ...post,
          matchedLanguage,
          language: matchedLanguage,
        });
      }
    }

    result.posts = keptPosts;

    const matches = [...new Set(result.posts.flatMap((post) => ((post as { language?: string }).language ? [(post as { language?: string }).language!] : [])))];
    await this.transformer.run('ProfileScrapeResult', result, {
      language: matches[0] ?? undefined,
      matches,
      collectedAt: new Date().toISOString(),
      source: 'x',
    });

    this.logger.log(`X result ready: ${result.posts.length} posts from ${result.handle}; saved timestamp=${now}`);
  }
}
