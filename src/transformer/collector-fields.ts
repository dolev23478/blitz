import type { CollectorReportFields } from '../contracts/collector-report.js';

/** Prefer new fields, then legacy spelling; per-message fields precede batch/caller defaults. */
export function collectorFields(
  source: CollectorReportFields,
  fallback: {
    languages?: unknown;
    language?: unknown;
    categories?: unknown;
  } = {},
) {
  return {
    languages:
      source.languages !== undefined
        ? source.languages
        : source.language !== undefined
          ? source.language
          : fallback.languages !== undefined
            ? fallback.languages
            : fallback.language,
    categories:
      source.categories !== undefined ? source.categories : fallback.categories,
  };
}
