import { Injectable, Logger } from '@nestjs/common';
import { State } from '../../common/enums.js';
import type { TransformContext } from '../transformer.types.js';

@Injectable()
export class CompletionProcessor {
  readonly stage = State.Completion;
  private readonly logger = new Logger(CompletionProcessor.name);

  async execute(context: TransformContext): Promise<void> {
    const { reports, publishedReports } = context;
    if (
      !reports ||
      !publishedReports ||
      publishedReports.length !== reports.length
    )
      throw new Error('Cannot complete before all reports are acknowledged.');
    context.result = publishedReports.map((report) => ({
      status: 'completed',
      inputId: context.inputId,
      reportId: report.report_id,
    }));
    for (const result of context.result) {
      this.logger.log({
        ...result,
        sourceId: context.sourceId,
        attempt: context.attempt,
        correlationId: context.correlationId,
        stage: this.stage,
      });
    }
  }
}
