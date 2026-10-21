import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { analyzeText } from '../text-analyzer.js';
import { TransformerWorkflow } from '../transformer/transformer.workflow.js';
import { RadioService } from './radio.service.js';
import { radioTranscriptSchema, type RadioTranscript } from './radio.types.js';

export type RadioPipelineResult =
  | {
      status: 'filtered';
      clipId: string;
      reason: 'no_speech' | 'no_dictionary_match';
    }
  | { status: 'published'; clipId: string };

/** The same analyzeText(auto) dictionary gate used by Telegram and X, before transformation. */
@Injectable()
export class RadioTransformerHandoff implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RadioTransformerHandoff.name);
  private unsubscribe?: () => void;

  constructor(
    @Inject(RadioService) private readonly radio: RadioService,
    @Inject(TransformerWorkflow)
    private readonly transformer: TransformerWorkflow,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.radio.watchTranscripts(async (clip, analysis) => {
      await this.process(clip, analysis);
    });
    this.logger.log({
      event: 'radio_pipeline_ready',
      filter: 'analyzeText(auto)',
      topic: 'reports.raw',
    });
  }

  async process(
    input: RadioTranscript,
    collectedAnalysis?: ReturnType<typeof analyzeText>,
  ): Promise<RadioPipelineResult> {
    this.logger.log({
      event: 'radio_input_received',
      clipId: input?.clipId,
      payload: input,
    });
    try {
      const clip = radioTranscriptSchema.parse(input);
      if (clip.status === 'no_speech' || !clip.text.trim()) {
        this.logger.log({
          event: 'radio_filter_result',
          clipId: clip.clipId,
          passed: false,
          reason: 'no_speech',
        });
        return { status: 'filtered', clipId: clip.clipId, reason: 'no_speech' };
      }

      const analysis = collectedAnalysis ?? analyzeText(clip.text, 'auto');
      const languages =
        clip.languages !== undefined ? clip.languages : [clip.language];
      this.logger.log({
        event: 'radio_analysis_completed',
        clipId: clip.clipId,
        stationId: clip.station.id,
        asrLanguage: clip.language,
        languages,
        dictionaryLanguages: analysis.languages ?? [],
        matches: analysis.terms,
        categories: analysis.categories,
        issues: analysis.issues,
        evaluation: analysis.evaluation,
      });
      this.logger.log({
        event: 'radio_filter_result',
        clipId: clip.clipId,
        passed: analysis.matched,
        reason: analysis.matched ? 'dictionary_match' : 'no_dictionary_match',
      });
      if (!analysis.matched)
        return {
          status: 'filtered',
          clipId: clip.clipId,
          reason: 'no_dictionary_match',
        };

      // Keep the archived ASR object intact. Dictionary labels (including em/emoji) are not spoken-language codes.
      const enriched: RadioTranscript = {
        ...clip,
        languages,
        matches: [...new Set([...(clip.matches ?? []), ...analysis.terms])],
        categories:
          clip.categories !== undefined ? clip.categories : analysis.categories,
      };
      this.logger.log({
        event: 'radio_transformer_input',
        clipId: clip.clipId,
        payload: enriched,
      });
      await this.transformer.run('RadioTranscript', enriched, {
        inputId: clip.clipId,
        source: 'radio',
      });
      this.logger.log({
        event: 'radio_pipeline_completed',
        clipId: clip.clipId,
      });
      return { status: 'published', clipId: clip.clipId };
    } catch (error) {
      this.logger.error({
        event: 'radio_pipeline_failed',
        clipId: input?.clipId,
        reason:
          error instanceof Error
            ? error.message.slice(0, 1500)
            : 'Unknown radio processing error',
      });
      throw error;
    }
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
