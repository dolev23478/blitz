import type { ProcessingContext } from '../../common/interfaces.js';
import type { CollectorInput } from '../../contracts/collectors.js';
import type { RawReport, RawReportCandidate } from '../../contracts/schema.js';

export interface RunOptions {
  readonly attempt?: number;
  readonly correlationId?: string;
}

export type PublicationResult = 'published' | 'duplicate';

export interface WorkflowResult {
  readonly status: 'completed' | 'duplicate';
  readonly inputId: string;
  readonly reportId: string;
}
/** One context per report, shared only by that report's processors. */
export interface TransformContext extends ProcessingContext {
  input: CollectorInput;
  parsedData?: unknown;
  candidate?: RawReportCandidate;
  report?: RawReport;
  publication?: PublicationResult;
  result?: WorkflowResult;
}

export interface Processor {
  execute(context: TransformContext): Promise<void>;
}
