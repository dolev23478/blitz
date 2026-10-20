import { beforeAll, describe, expect, it } from 'vitest';
import { loadDictionaries } from '../../src/dictionaries/load-dictionaries.js';
import { createTemporaryIntegration } from '../../src/sample-feed/integration.js';
import {
  LocalPublishingProcessor,
  contractGaps,
} from '../../src/sample-feed/local-publisher.js';
import { runSamples, summarize } from '../../src/sample-feed/runner.js';
import {
  loadSamples,
  selectScenario,
  validateSamples,
} from '../../src/sample-feed/samples.js';
import { standInDetectLanguage } from '../../src/sample-feed/stand-ins.js';
import type {
  PostPipeline,
  RawReport,
  Sample,
} from '../../src/sample-feed/types.js';
import { TextAnalyzer } from '../../src/text-analyzer.js';
import type { PublishingProcessor } from '../../src/transformer/processors/publishing.processor.js';
import { workflow } from '../transformer/fixtures.js';

/** Real TextAnalyzer and real TransformerWorkflow (built by hand, as in Yoav's tests); only the publisher is local. */
function pipeline(): {
  pipeline: PostPipeline;
  local: LocalPublishingProcessor;
} {
  const local = new LocalPublishingProcessor();
  const analyzer = new TextAnalyzer({
    store: loadDictionaries({ dictionariesDir: 'samples/dictionaries' }),
  });
  return {
    local,
    pipeline: createTemporaryIntegration({
      detectLanguage: standInDetectLanguage,
      analyzer,
      workflow: workflow(local as unknown as PublishingProcessor),
      local,
    }),
  };
}

let samples: Sample[];
let invalid: Awaited<ReturnType<typeof loadSamples>>;
beforeAll(async () => {
  samples = (await loadSamples('samples/posts.json')).valid;
  invalid = await loadSamples('samples/invalid-posts.json');
});

describe('sample files', () => {
  it('posts.json is fully valid and covers both collector formats', async () => {
    const main = await loadSamples('samples/posts.json');
    expect(main.issues).toEqual([]);
    expect(samples.length).toBeGreaterThanOrEqual(12);
    expect(new Set(samples.map((s) => s.format))).toEqual(
      new Set(['StoredMessage', 'ProfileScrapeResult']),
    );
    expect(selectScenario(samples, 'duplicate').map((s) => s.id)).toEqual([
      'dup-first',
      'dup-second',
    ]);
  });

  it('invalid-posts.json names the sample and the field of every problem', () => {
    expect(invalid.valid.map((s) => s.id)).toEqual([
      'transformer-rejects-html',
      'valid-control',
    ]);
    const at = (sample: string) =>
      invalid.issues.filter((i) => i.sample === sample).map((i) => i.field);
    expect(at('invalid-photo-without-text')).toEqual(['post.text']);
    expect(at('invalid-x-media-type')).toEqual(['post.posts[0].media[0].type']);
    expect(at('invalid-missing-url-and-fetched-at')).toEqual([
      'post.url',
      'post.fetchedAt',
    ]);
    expect(at('invalid-precomputed-results')).toEqual([
      'post.language',
      'post.matches',
      'post.postedat',
    ]);
    expect(at('invalid-x-two-posts')).toEqual(['post.posts']);
    expect(at('invalid-format')).toEqual(['format']);
  });

  it('rejects a file without a samples array and repeated sample ids', () => {
    expect(validateSamples([]).issues[0]).toMatchObject({
      sample: '(file)',
      field: 'samples',
    });
    const one = samples[0]!;
    const r = validateSamples({ samples: [one, one] });
    expect(r.issues).toEqual([
      expect.objectContaining({ sample: one.id, field: 'id' }),
    ]);
  });
});

describe('full flow: language -> TextAnalyzer -> TransformerWorkflow -> local publisher', () => {
  it('a matching post is mapped, validated by the transformer and recorded with key = report_id', async () => {
    const { pipeline: p } = pipeline();
    const [r] = await runSamples(
      p,
      selectScenario(samples, 'passes').slice(0, 1),
    );
    expect(r!.mismatches).toEqual([]);
    const o = r!.outcome;
    if (o.status !== 'processed')
      throw new Error(`expected processed, got ${o.status}`);
    const [msg] = o.published;
    expect(msg!.confirmed).toBe(false);
    expect(msg!.key).toBe(String(msg!.report!.report_id));
    expect(JSON.parse(msg!.json!)).toMatchObject({
      language: 'he',
      matches: ['אזעקה'],
      is_official: false,
    });
    expect(msg!.report).not.toHaveProperty('reality_id');
  });

  it('a post without dictionary terms is filtered out and never reaches the transformer', async () => {
    const { pipeline: p, local } = pipeline();
    const results = await runSamples(p, selectScenario(samples, 'filtered'));
    expect(results.map((r) => r.outcome.status)).toEqual([
      'filtered',
      'filtered',
      'filtered',
    ]);
    expect(local.take()).toEqual([]);
  });

  it('runs every default sample; the only mismatch is the duplicate, since no dedup exists yet', async () => {
    const { pipeline: p } = pipeline();
    const results = await runSamples(p, samples);
    expect(
      results.filter((r) => r.mismatches.length).map((r) => r.sample.id),
    ).toEqual(['dup-second']);
    const s = summarize(
      results,
      { read: samples.length, invalidInput: 0, notSelected: 0 },
      false,
    );
    expect(s).toMatchObject({
      filtered: 3,
      duplicates: null,
      failed: 0,
      processed: 11,
      localOnly: 11,
      kafkaConfirmed: 0,
    });
    // Same post twice -> same key (DE upserts by key), but BLITZ still sends it twice.
    const keys = results
      .filter((r) => r.sample.tags.includes('duplicate'))
      .map((r) =>
        r.outcome.status === 'processed' ? r.outcome.published[0]!.key : null,
      );
    expect(keys[0]).not.toBeNull();
    expect(keys[0]).toBe(keys[1]);
  });

  it("Yoav's validation rejects HTML content before anything is published", async () => {
    const { pipeline: p, local } = pipeline();
    const [r] = await runSamples(
      p,
      invalid.valid.filter((s) => s.id === 'transformer-rejects-html'),
    );
    expect(r!.outcome).toMatchObject({
      status: 'failed',
      stage: 'transformer/validation_failed',
    });
    expect(r!.mismatches).toEqual([]);
    expect(local.take()).toEqual([]);
  });
});

describe('contract gaps vs schemas.html', () => {
  const report = (): RawReport =>
    ({
      report_id: 1,
      schema_version: 1,
      is_official: false,
      platform: 'telegram',
      account_name: 'a',
      channel_name: 'c',
      report_url: 'https://fixtures.blitz.invalid/1',
      media_type: ['text'],
      report_title: null,
      content: 'x',
      language: 'he',
      matches: [],
      published_at: null,
      collected_at: '2026-10-19T08:00:00Z',
    }) as unknown as RawReport;

  it('accepts a report that matches the field list', () => {
    expect(contractGaps(report())).toEqual([]);
  });

  it('reports the differences the current transformer output has', () => {
    const gaps = contractGaps({
      ...report(),
      schema_version: '1.0.0',
      channel_name: null,
      language: 'unknown',
      media_type: ['text', 'document'],
    } as never).join('\n');
    for (const f of [
      'schema_version',
      'channel_name',
      'language',
      'media_type',
    ])
      expect(gaps).toMatch(f);
    expect(contractGaps({ ...report(), reality_id: 0 } as never)).toEqual([
      'reality_id: not a RAW_REPORT field',
    ]);
  });
});
