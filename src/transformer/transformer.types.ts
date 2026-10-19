import type { ProcessingContext } from '../common/interfaces.js';
import type { MappingFormat, ReportMetadata } from '../contracts/mappings.js';
import type { RawReport, RawReportCandidate } from '../contracts/schema.js';

export interface RunOptions extends ReportMetadata {
  readonly inputId?: string;
  readonly attempt?: number;
  readonly correlationId?: string;
}

export interface WorkflowResult {
  readonly status: 'completed';
  readonly inputId: string;
  readonly reportId: number;
}

/** Original collector object and processing data for one workflow invocation. */
export interface TransformContext extends ProcessingContext {
  format: MappingFormat;
  input: unknown;
  metadata: ReportMetadata;
  candidates?: RawReportCandidate[];
  reports?: RawReport[];
  publishedReports?: RawReport[];
  result?: WorkflowResult[];
}

export interface Processor {
  execute(context: TransformContext): Promise<void>;
}
