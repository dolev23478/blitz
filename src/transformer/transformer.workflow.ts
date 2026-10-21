import { Injectable, Logger } from '@nestjs/common';
import StateMachine from 'javascript-state-machine';
import { randomUUID } from 'node:crypto';
import { State } from '../common/enums.js';
import type { ProfileScrapeResult } from '../x-scraper/contracts/x-scraper.interfaces.js';
import type { ParsedMessage } from '../types.js';
import type { RadioTranscript } from '../radio/radio.types.js';
import type { MappingFormat } from '../contracts/mappings.js';
import { CompletionProcessor } from './processors/completion.processor.js';
import { MappingProcessor } from './processors/mapping.processor.js';
import { ParsingProcessor } from './processors/parsing.processor.js';
import { PublishingProcessor } from './processors/publishing.processor.js';
import { ValidationProcessor } from './processors/validation.processor.js';
import type {
  Processor,
  RunOptions,
  TransformContext,
  WorkflowResult,
} from './transformer.types.js';

@Injectable()
export class TransformerWorkflow {
  private readonly logger = new Logger(TransformerWorkflow.name);
  constructor(
    private readonly parser: ParsingProcessor,
    private readonly mapper: MappingProcessor,
    private readonly validator: ValidationProcessor,
    private readonly publisher: PublishingProcessor,
    private readonly completion: CompletionProcessor,
  ) {}

  run(
    format: 'ProfileScrapeResult',
    data: ProfileScrapeResult,
    options?: RunOptions,
  ): Promise<WorkflowResult[]>;
  run(
    format: 'ParsedMessage',
    data: ParsedMessage,
    options?: RunOptions,
  ): Promise<WorkflowResult[]>;
  run(
    format: 'RadioTranscript',
    data: RadioTranscript,
    options?: RunOptions,
  ): Promise<WorkflowResult[]>;

  /** Pass the collector's object directly and select its format's mapper. */
  async run(
    format: MappingFormat,
    data: unknown,
    options: RunOptions = {},
  ): Promise<WorkflowResult[]> {
    const context: TransformContext = {
      format,
      input: data,
      metadata:
        format === 'ParsedMessage'
          ? { ...options, collectedAt: new Date().toISOString() }
          : options,
      inputId: options.inputId ?? randomUUID(),
      sourceId: format,
      attempt: options.attempt ?? 1,
      correlationId: options.correlationId,
    };

    const machine = new StateMachine({
      init: State.Parsing,
      transitions: [
        { name: 'success', from: State.Parsing, to: State.Mapping },
        { name: 'success', from: State.Mapping, to: State.Validation },
        { name: 'success', from: State.Validation, to: State.Publishing },
        { name: 'success', from: State.Publishing, to: State.Completion },
        { name: 'fail', from: '*', to: State.Failed },
      ],
    });
    const processors: Partial<Record<State, Processor>> = {
      [State.Parsing]: this.parser,
      [State.Mapping]: this.mapper,
      [State.Validation]: this.validator,
      [State.Publishing]: this.publisher,
    };

    try {
      while (
        machine.state !== State.Completion &&
        machine.state !== State.Failed
      ) {
        const processor = processors[machine.state as State];
        if (!processor) throw new Error('Unknown transformer state.');
        await processor.execute(context);
        if (format === 'RadioTranscript') {
          this.logger.log({
            event: 'radio_transformer_stage_completed',
            clipId: context.inputId,
            stage: machine.state,
            ...(machine.state === State.Mapping
              ? { reports: context.candidates }
              : {}),
            ...(machine.state === State.Validation
              ? { reports: context.reports }
              : {}),
          });
        }
        machine.success();
      }
      await this.completion.execute(context);
      if (!context.result) throw new Error('Missing transformer result.');
      return context.result;
    } catch (error) {
      if (format === 'RadioTranscript')
        this.logger.error({
          event: 'radio_transformer_stage_failed',
          clipId: context.inputId,
          stage: machine.state,
          reason:
            error instanceof Error
              ? error.message
              : 'Unknown Transformer error',
        });
      machine.fail();
      throw error;
    }
  }
}
