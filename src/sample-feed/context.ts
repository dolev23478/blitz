/**
 * THE CONNECTION POINT. Builds a Nest application context from the team modules and wires the
 * sample feed into it. Nothing here starts collection: the context holds only the modules below,
 * never AppModule (which would start the Telegram/X collectors and the DB).
 *
 * Status on dev, 20.10.2026:
 *   integration  Gal     missing -> temporary integration (integration.ts)
 *   language     Leonid  missing -> stand-in (stand-ins.ts)
 *   filter       Leonid  TextAnalyzer (team)
 *   transformer  Yoav    TransformerModule: mapping, validation, publishing (team)
 *   dedup        Yoav    missing: nothing detects duplicates yet
 */
import { Logger, Module, type INestApplicationContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { resolve } from 'node:path';
import { loadDictionaries } from '../dictionaries/load-dictionaries.js';
import { TextAnalyzer } from '../text-analyzer.js';
import { PublishingProcessor } from '../transformer/processors/publishing.processor.js';
import { TransformerModule } from '../transformer/transformer.module.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';
import { createTemporaryIntegration } from './integration.js';
import { LocalPublishingProcessor } from './local-publisher.js';
import { standInDetectLanguage } from './stand-ins.js';
import type {
  ComponentName,
  ComponentSource,
  LanguageDetector,
  PostPipeline,
} from './types.js';

export const DEMO_DICTIONARIES = 'samples/dictionaries';

/** Set these when the components are merged; the tool then uses them and labels them `team`. */
export const teamComponents: {
  /** Leonid: language model. */
  detectLanguage?: LanguageDetector;
  /**
   * Gal: the integration the collectors call, taken from the context. Its module must be added to
   * SampleFeedHostModule and must reach Kafka only through PublishingProcessor (so local runs can
   * replace it) and dedup only through a provider local runs can replace the same way.
   */
  integration?: (ctx: INestApplicationContext) => PostPipeline;
} = {};

/** Root of the context: config (.env) plus the processing modules, no collectors. */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), TransformerModule],
})
export class SampleFeedHostModule {}

export class CannotRunError extends Error {}

export interface SampleFeedContext {
  pipeline: PostPipeline;
  sources: Record<ComponentName, ComponentSource>;
  dictionaryLanguages: string[];
  /** DE_RAW_REPORT_SCHEMA_PATH is set, so the transformer also validates against the DE contract. */
  deSchemaConfigured: boolean;
  close(): Promise<void>;
}

export async function createSampleFeedContext(opts: {
  mode: 'local' | 'publish';
  dictionariesDir?: string;
}): Promise<SampleFeedContext> {
  const dictionariesDir = resolve(
    opts.dictionariesDir ?? process.env.DICTIONARIES_DIR ?? DEMO_DICTIONARIES,
  );
  const demoDictionaries = dictionariesDir === resolve(DEMO_DICTIONARIES);
  const detectLanguage = teamComponents.detectLanguage ?? standInDetectLanguage;

  if (opts.mode === 'publish') {
    const missing = [
      !teamComponents.detectLanguage && 'language detection (Leonid)',
      demoDictionaries &&
        'the real dictionaries (--dictionaries <dir> or DICTIONARIES_DIR; samples/dictionaries is demo data)',
    ].filter(Boolean);
    if (missing.length) {
      throw new CannotRunError(
        `--publish sends to the real reports.raw, so stand-ins are not allowed. Missing: ${missing.join('; ')}. Nothing was sent.`,
      );
    }
  }

  const store = loadDictionaries({ dictionariesDir });
  const analyzer = new TextAnalyzer({ store });

  Logger.overrideLogger(['warn', 'error']);
  let ctx: INestApplicationContext;
  let local: LocalPublishingProcessor | undefined;
  if (opts.mode === 'local') {
    // A testing module is a Nest application context that can replace one provider of an imported
    // module. Only the publisher is replaced; mapping and validation are Yoav's real providers.
    ctx = await Test.createTestingModule({ imports: [SampleFeedHostModule] })
      .overrideProvider(PublishingProcessor)
      .useClass(LocalPublishingProcessor)
      .compile();
    await ctx.init();
    local = ctx.get(PublishingProcessor) as unknown as LocalPublishingProcessor;
  } else {
    ctx = await NestFactory.createApplicationContext(SampleFeedHostModule);
    if (!ctx.get(ConfigService).get<string>('KAFKA_BROKERS')) {
      await ctx.close();
      throw new CannotRunError(
        '--publish needs KAFKA_BROKERS (see .env.example). Nothing was sent.',
      );
    }
  }

  const pipeline = teamComponents.integration
    ? teamComponents.integration(ctx)
    : createTemporaryIntegration({
        detectLanguage,
        analyzer,
        workflow: ctx.get(TransformerWorkflow),
        local,
      });

  return {
    pipeline,
    sources: {
      integration: teamComponents.integration ? 'team' : 'stand-in',
      language: teamComponents.detectLanguage ? 'team' : 'stand-in',
      filter: 'team',
      dictionary: demoDictionaries ? 'stand-in' : 'team',
      transformer: 'team',
      dedup: 'missing',
      publisher: opts.mode === 'local' ? 'stand-in' : 'team',
    },
    dictionaryLanguages: store.languages(),
    deSchemaConfigured: Boolean(
      ctx.get(ConfigService).get<string>('DE_RAW_REPORT_SCHEMA_PATH'),
    ),
    close: () => ctx.close(),
  };
}
