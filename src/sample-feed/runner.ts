import type { PostOutcome, PostPipeline, Sample } from './types.js';

export interface SampleResult {
  sample: Sample;
  outcome: PostOutcome;
  /** Differences from `sample.expect`; empty when it matches or there is no expectation. */
  mismatches: string[];
}

/** Every selected sample lands in exactly one of filtered, failed, processed. */
export interface RunSummary {
  /** Samples in the file, valid or not. */
  read: number;
  invalidInput: number;
  /** Valid samples not tagged with the chosen scenario. */
  notSelected: number;
  filtered: number;
  /** Reported by a dedup component; null while no such component exists in the pipeline. */
  duplicates: number | null;
  /** A step threw: language, filter, or a transformer stage (mapping, validation, publishing). */
  failed: number;
  /** Went through every step: split into localOnly and kafkaConfirmed. */
  processed: number;
  /** Local run: messages recorded instead of sent. Nothing reached Kafka. */
  localOnly: number;
  /** --publish: messages Kafka acknowledged. */
  kafkaConfirmed: number;
  /** Processed samples whose message differs from the RAW_REPORT list in schemas.html. */
  withContractGaps: number;
  expectationMismatches: number;
}

export function compareExpectation(
  sample: Sample,
  outcome: PostOutcome,
): string[] {
  const exp = sample.expect;
  if (!exp) return [];
  const out: string[] = [];
  if (outcome.status !== exp.outcome) {
    const why =
      exp.outcome === 'duplicate'
        ? ' (no dedup component in the pipeline yet)'
        : '';
    out.push(`outcome: expected ${exp.outcome}, got ${outcome.status}${why}`);
  }
  if (
    exp.language &&
    'language' in outcome &&
    outcome.language !== exp.language
  ) {
    out.push(`language: expected ${exp.language}, got ${outcome.language}`);
  }
  if (exp.matchesInclude && outcome.status === 'processed') {
    const missing = exp.matchesInclude.filter(
      (m) => !outcome.matches.includes(m),
    );
    if (missing.length) out.push(`matches: missing ${missing.join(', ')}`);
  }
  return out;
}

/** Feeds samples one by one, in file order, so a repeated post follows the first copy. */
export async function runSamples(
  pipeline: PostPipeline,
  samples: Sample[],
): Promise<SampleResult[]> {
  const results: SampleResult[] = [];
  for (const sample of samples) {
    let outcome: PostOutcome;
    try {
      outcome = await pipeline.process(sample);
    } catch (err) {
      outcome = {
        status: 'failed',
        stage: 'integration',
        error: err instanceof Error ? err.message : String(err),
      };
    }
    results.push({
      sample,
      outcome,
      mismatches: compareExpectation(sample, outcome),
    });
  }
  return results;
}

export function summarize(
  results: SampleResult[],
  counts: { read: number; invalidInput: number; notSelected: number },
  hasDedup: boolean,
): RunSummary {
  const s: RunSummary = {
    ...counts,
    filtered: 0,
    duplicates: hasDedup ? 0 : null,
    failed: 0,
    processed: 0,
    localOnly: 0,
    kafkaConfirmed: 0,
    withContractGaps: 0,
    expectationMismatches: 0,
  };
  for (const { outcome, mismatches } of results) {
    if (mismatches.length) s.expectationMismatches++;
    if (outcome.status === 'filtered') s.filtered++;
    else if (outcome.status === 'failed') s.failed++;
    else {
      s.processed++;
      if (outcome.contractGaps.length) s.withContractGaps++;
      for (const p of outcome.published) {
        if (p.confirmed) s.kafkaConfirmed++;
        else s.localOnly++;
      }
    }
  }
  return s;
}
