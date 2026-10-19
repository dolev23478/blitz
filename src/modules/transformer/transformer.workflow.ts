import { Injectable } from '@nestjs/common';
import StateMachine from 'javascript-state-machine';
import { State } from '../../common/enums.js';
import { CompletionProcessor } from './processors/completion.processor.js';
import { MappingProcessor } from './processors/mapping.processor.js';
import { ParsingProcessor } from './processors/parsing.processor.js';
import { PublishingProcessor } from './processors/publishing.processor.js';
import { receiveInput } from './input.js';
import { ValidationProcessor } from './processors/validation.processor.js';
import type {
  Processor,
  RunOptions,
  TransformContext,
  WorkflowResult,
} from './transformer.types.js';

@Injectable()
export class TransformerWorkflow {
  constructor(
    private readonly parser: ParsingProcessor,
    private readonly mapper: MappingProcessor,
    private readonly validator: ValidationProcessor,
    private readonly publisher: PublishingProcessor,
    private readonly completion: CompletionProcessor,
  ) {}

  /** Another service passes one collected item. The caller owns retries. */
  async run(data: unknown, options: RunOptions = {}): Promise<WorkflowResult> {
    const input = receiveInput(data);
    const context: TransformContext = {
      input,
      inputId: input.inputId,
      sourceId: input.source.id,
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
        machine.success();
      }
      await this.completion.execute(context);
      if (!context.result) throw new Error('Missing transformer result.');
      return context.result;
    } catch (error) {
      machine.fail();
      throw error;
    }
  }
}
