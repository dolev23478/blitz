/**
 * End-to-end test of the BLITZ pipeline, from collector output to the reports.raw message:
 *   collector object -> Gal's integration (TelegramListenerService / XScraperCronService)
 *   -> Leonid's analyzeText (language + terms) -> Yoav's TransformerWorkflow (map, validate)
 *   -> the message that would go to Kafka.
 * Only the Kafka send is replaced: RecordingPublisher stands in for PublishingProcessor and
 * serializes with Yoav's ReportValidator, so the recorded key and value are what Kafka would get.
 * Redis is off. Run: npm run test:pipeline
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { NewMessagesEvent } from '../../src/events/message-events.service.js';
import { TelegramListenerService } from '../../src/telegram/telegram-listener.service.js';
import type { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import { ReportValidator } from '../../src/transformer/report-validator.js';
import type { TransformContext } from '../../src/transformer/transformer.types.js';
import type { ProfileScrapeResult } from '../../src/x-scraper/contracts/x-scraper.interfaces.js';
import { XScraperCronService } from '../../src/x-scraper/x-scraper.cron.service.js';
import { workflow } from '../transformer/fixtures.js';
import {
  telegramCases,
  telegramEvent,
  xCases,
  xResult,
  type Expectation,
} from './cases.js';
import { contractProblems } from './raw-report.contract.js';

interface KafkaRecord {
  key: string;
  value: string;
  report: Record<string, any>;
}

/** Replaces only PublishingProcessor: records what would be sent instead of sending it. */
class RecordingPublisher {
  readonly records: KafkaRecord[] = [];
  private readonly validator = new ReportValidator(new ConfigService());

  async execute(context: TransformContext): Promise<void> {
    context.publishedReports = [];
    for (const report of context.reports ?? []) {
      const value = this.validator.serialize(report);
      const parsed = JSON.parse(value);
      this.records.push({
        key: String(report.report_id),
        value,
        report: parsed,
      });
      context.publishedReports.push(parsed);
    }
  }
}

const noRedis = {
  isEnabled: () => false,
  get: async () => null,
  set: async () => 'OK',
};

/** Errors the pipeline logged, so a failing case says why nothing was sent. */
const logged: string[] = [];
beforeAll(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(
    (msg: unknown) => void logged.push(String(msg)),
  );
});
afterAll(() => vi.restoreAllMocks());

/** Feeds one or more Telegram events through Gal's listener, like TelegramService does. */
async function runTelegram(
  ...events: NewMessagesEvent[]
): Promise<{ records: KafkaRecord[]; errors: string[] }> {
  const publisher = new RecordingPublisher();
  let deliver!: (event: NewMessagesEvent) => void | Promise<void>;
  const telegram = {
    watchResults: (cb: typeof deliver) => ((deliver = cb), () => undefined),
  };
  new TelegramListenerService(
    telegram as never,
    noRedis as never,
    workflow(publisher as unknown as PublishingProcessor),
  );
  const errors: string[] = [];
  for (const event of events) {
    try {
      await deliver(event);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { records: publisher.records, errors };
}

/** Runs one X cron cycle whose scrape returns the given result. */
async function runX(
  result: ProfileScrapeResult,
): Promise<{ records: KafkaRecord[]; errors: string[] }> {
  const publisher = new RecordingPublisher();
  const scraper = { scrapeBatch: async () => structuredClone(result) };
  const cron = new XScraperCronService(
    scraper as never,
    noRedis as never,
    workflow(publisher as unknown as PublishingProcessor),
  );
  logged.length = 0;
  await (cron as unknown as { runCycle(): Promise<void> }).runCycle();
  return { records: publisher.records, errors: [...logged] };
}

function checkExpectation(
  record: KafkaRecord | undefined,
  exp: Expectation,
  why: string[],
): void {
  if (!exp.sent) {
    expect(record, `should not be sent (${exp.why})`).toBeUndefined();
    return;
  }
  expect(
    record,
    `nothing reached Kafka. Pipeline errors: ${why.join(' | ') || 'none'}`,
  ).toBeDefined();
  const r = record!.report;
  // Read the old single `language` too, so a detection result is visible even before the field rename.
  const languages: string[] = Array.isArray(r.languages)
    ? r.languages
    : r.language
      ? [r.language]
      : [];
  for (const lang of exp.languages)
    expect(languages, `languages of ${r.report_url}`).toContain(lang);
  for (const term of exp.matches)
    expect(r.matches, `matches of ${r.report_url}`).toContain(term);
  for (const term of exp.notMatches ?? [])
    expect(r.matches, `matches of ${r.report_url}`).not.toContain(term);
  if (exp.mediaType) expect(r.media_type).toEqual(exp.mediaType);
}

const allRecords: { source: string; record: KafkaRecord }[] = [];

describe('Telegram → reports.raw', () => {
  for (const c of telegramCases) {
    it(`${c.id}: ${c.title}`, async () => {
      const { records, errors } = await runTelegram(telegramEvent([c.message]));
      const record = records.find(
        (rec) => rec.report.report_url === c.message.url,
      );
      checkExpectation(record, c.expect, errors);
      if (record) {
        allRecords.push({ source: c.id, record });
        expect(record.report.platform).toBe('telegram');
        expect(record.report.content).toBe(c.message.text!.trim());
        expect(record.report.published_at).toBe(
          c.message.postedAt.toISOString(),
        );
      }
    });
  }

  it('a message the transformer rejects does not stop the rest of the event', async () => {
    const bad = {
      ...telegramCases[0]!.message,
      messageId: 2001,
      url: 'https://t.me/blitz_fixture_channel/2001',
      text: '<b>פיגוע</b> בצומת',
    };
    const good = {
      ...telegramCases[0]!.message,
      messageId: 2002,
      url: 'https://t.me/blitz_fixture_channel/2002',
    };
    const { records } = await runTelegram(telegramEvent([bad, good]));
    expect(records.map((r) => r.report.report_url)).toEqual([good.url]);
  });

  it('the same post collected twice is sent once (collectors remove duplicates)', async () => {
    const message = telegramCases[0]!.message;
    const { records } = await runTelegram(
      telegramEvent([message]),
      telegramEvent([structuredClone(message)]),
    );
    expect(
      new Set(records.map((r) => r.key)).size,
      'same post must keep the same key',
    ).toBe(1);
    expect(
      records,
      'sent more than once: no deduplication before Kafka',
    ).toHaveLength(1);
  });
});

describe('X → reports.raw', () => {
  for (const c of xCases) {
    it(`${c.id}: ${c.title}`, async () => {
      const { records, errors } = await runX(
        xResult(c.posts.map((p) => p.post)),
      );
      for (const { post, expect: exp } of c.posts) {
        const record = records.find(
          (rec) => rec.report.report_url === post.url,
        );
        checkExpectation(record, exp, errors);
        if (record) {
          allRecords.push({ source: c.id, record });
          expect(record.report.content).toBe(post.text.trim());
          expect(record.report.published_at).toBe(post.publishedAt);
        }
      }
    });
  }
});

describe('every message matches RAW_REPORT (schemas.html, 20.10.2026)', () => {
  it('has messages to check', () => {
    expect(allRecords.length).toBeGreaterThan(0);
  });

  it('every message passes the contract', () => {
    const failures = allRecords
      .map(({ source, record }) => ({
        source,
        problems: contractProblems(record.report),
      }))
      .filter((f) => f.problems.length);
    expect(
      failures,
      failures.map((f) => `${f.source}: ${f.problems.join('; ')}`).join('\n'),
    ).toEqual([]);
  });

  it('the Kafka key is report_id as a string, and the value is the same JSON', () => {
    for (const { record } of allRecords) {
      expect(record.key).toBe(String(record.report.report_id));
      expect(JSON.parse(record.value)).toEqual(record.report);
    }
  });

  it('report_id is stable for the same post and different for different posts', () => {
    const byUrl = new Map<string, string>();
    for (const { record } of allRecords) {
      const prev = byUrl.get(record.report.report_url);
      if (prev) expect(record.key).toBe(prev);
      byUrl.set(record.report.report_url, record.key);
    }
    expect(new Set(byUrl.values()).size).toBe(byUrl.size);
  });
});
