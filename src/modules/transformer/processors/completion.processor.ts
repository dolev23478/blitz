import { Injectable, Logger } from '@nestjs/common';
import { State } from '../../../common/enums.js';
import type { TransformContext } from '../transformer.types.js';

@Injectable()
export class CompletionProcessor {
  readonly stage = State.Completion;
  private readonly logger = new Logger(CompletionProcessor.name);

  async execute(context: TransformContext): Promise<void> {
    const { report, publication } = context;
    if (!report || !publication)
      throw new Error('Cannot complete before publication.');
    context.result = {
      status: publication === 'duplicate' ? 'duplicate' : 'completed',
      inputId: context.inputId,
      reportId: report.report_id,
    };
    this.logger.log({
      ...context.result,
      sourceId: context.sourceId,
      attempt: context.attempt,
      correlationId: context.correlationId,
      stage: this.stage,
    });
  }
}
