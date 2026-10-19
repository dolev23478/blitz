import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransformerErrorCode } from '../../common/enums.js';
import { TransformerException } from '../../common/exceptions.js';
import type { ReportIdentity } from '../../contracts/schema.js';

interface Entry {
  readonly id: string;
  readonly urlKey: string;
  readonly finished: Promise<void>;
  readonly finish: () => void;
  publishedAt?: number;
}

/** MVP only: process-local deduplication, lost on restart and not shared by replicas. */
@Injectable()
export class DeduplicationStore {
  private readonly byId = new Map<string, Entry>();
  private readonly byUrl = new Map<string, Entry>();
  private readonly ttl: number;
  private readonly limit: number;

  constructor(config: ConfigService) {
    this.ttl = Number(config.get('DEDUP_TTL_MS') ?? 86400000);
    this.limit = Number(config.get('DEDUP_MAX_ENTRIES') ?? 10000);
    if (
      !Number.isSafeInteger(this.ttl) ||
      this.ttl <= 0 ||
      !Number.isSafeInteger(this.limit) ||
      this.limit <= 0
    ) {
      throw new Error(
        'DEDUP_TTL_MS and DEDUP_MAX_ENTRIES must be positive integers.',
      );
    }
  }

  /** True reserves publication. False means a previous publication was acknowledged. */
  async reserve(report: ReportIdentity): Promise<boolean> {
    const urlKey = JSON.stringify([report.platform, report.report_url]);
    for (;;) {
      this.removeExpired();
      const byId = this.byId.get(report.report_id);
      if (byId && byId.urlKey !== urlKey) {
        throw new TransformerException(
          TransformerErrorCode.ValidationFailed,
          'A report ID refers to a different platform/URL identity.',
        );
      }
      const existing = byId ?? this.byUrl.get(urlKey);
      if (existing) {
        if (existing.publishedAt !== undefined) return false;
        // An in-flight reservation is not a published duplicate. Wait for its outcome.
        await existing.finished;
        continue;
      }
      if (this.byId.size >= this.limit) {
        throw new TransformerException(
          TransformerErrorCode.PublicationFailed,
          'Deduplication capacity reached; retry after entries expire.',
        );
      }
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const entry: Entry = { id: report.report_id, urlKey, finished, finish };
      this.byId.set(entry.id, entry);
      this.byUrl.set(urlKey, entry);
      return true;
    }
  }

  markPublished(report: ReportIdentity): void {
    const entry = this.byId.get(report.report_id);
    if (!entry) throw new Error('Missing publication reservation.');
    entry.publishedAt = Date.now();
    entry.finish();
  }

  release(report: ReportIdentity): void {
    const entry = this.byId.get(report.report_id);
    if (entry && entry.publishedAt === undefined) this.remove(entry);
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const entry of this.byId.values()) {
      if (
        entry.publishedAt !== undefined &&
        now - entry.publishedAt >= this.ttl
      )
        this.remove(entry);
    }
  }

  private remove(entry: Entry): void {
    this.byId.delete(entry.id);
    this.byUrl.delete(entry.urlKey);
    entry.finish();
  }
}
