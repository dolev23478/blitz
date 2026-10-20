/**
 * TEMPORARY INTEGRATION, until Gal's integration of the components exists in dev.
 * It only calls the components in order and adds no logic of its own:
 *   language (Leonid) -> TextAnalyzer filter (Leonid) -> TransformerWorkflow (Yoav: map, validate, publish)
 * Language comes first because TextAnalyzer.analyze(text, language) needs the language as input.
 * When Gal's integration lands, context.ts uses it instead (see `teamComponents.integration`).
 */
import { TransformerException } from '../common/exceptions.js';
import type { TextAnalyzer } from '../text-analyzer.js';
import type { TransformerWorkflow } from '../transformer/transformer.workflow.js';
import type { LocalPublishingProcessor } from './local-publisher.js';
import { contractGaps } from './local-publisher.js';
import { postText } from './samples.js';
import type {
  LanguageDetector,
  PostOutcome,
  PostPipeline,
  PublishedMessage,
  Sample,
} from './types.js';

export interface IntegrationDeps {
  detectLanguage: LanguageDetector;
  analyzer: TextAnalyzer;
  workflow: TransformerWorkflow;
  /** Set in local runs: the recorder that replaced PublishingProcessor. */
  local?: LocalPublishingProcessor;
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

export function createTemporaryIntegration(
  deps: IntegrationDeps,
): PostPipeline {
  return {
    async process(sample: Sample): Promise<PostOutcome> {
      const text = postText(sample);

      let language: string;
      try {
        language = await deps.detectLanguage(text);
      } catch (err) {
        return { status: 'failed', stage: 'language', error: message(err) };
      }

      const analysis = deps.analyzer.analyze(text, language);
      if (analysis.issues.length) {
        // e.g. NO_DICTIONARIES: the filter could not decide, which is not the same as "no match".
        return {
          status: 'failed',
          stage: 'filter',
          error: analysis.issues
            .map((i) => `${i.code}: ${i.message}`)
            .join('; '),
        };
      }
      if (!analysis.matched)
        return { status: 'filtered', language, matches: [] };

      let published: PublishedMessage[];
      try {
        // The overloads only differ by format; the samples were validated against that format.
        const results = await deps.workflow.run(
          sample.format as 'StoredMessage',
          sample.post as never,
          {
            language,
            matches: analysis.terms,
            inputId: sample.id,
          },
        );
        published = deps.local
          ? deps.local.take()
          : results.map((r) => ({ key: String(r.reportId), confirmed: true }));
      } catch (err) {
        deps.local?.take();
        const stage =
          err instanceof TransformerException
            ? `transformer/${err.code}`
            : 'transformer';
        return { status: 'failed', stage, error: message(err) };
      }

      const gaps = published.flatMap((p) =>
        p.report ? contractGaps(p.report) : [],
      );
      return {
        status: 'processed',
        language,
        matches: analysis.terms,
        published,
        contractGaps: gaps,
      };
    },
  };
}
