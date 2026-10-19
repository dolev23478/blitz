import type { TransformerErrorCode, State } from './enums.js';

/** Application metadata, separate from the report and the Redis delivery handle. */
export interface ProcessingContext {
  readonly inputId: string;
  readonly sourceId: string;
  /** One-based processing attempt, supplied by the future orchestrator. */
  readonly attempt: number;
  readonly correlationId?: string;
}

/** A responsibility-based processor. Only the orchestrator connects processors. */
export interface Processor<TInput, TOutput> {
  readonly stage: State;
  process(input: TInput, context: ProcessingContext): Promise<TOutput>;
}

export interface ValidationIssue {
  /** JSON Pointer to the offending field; an empty string identifies the root. */
  readonly path: string;
  readonly code: string;
  /** Safe description: do not embed raw payloads or credentials. */
  readonly message: string;
}

export interface TransformerFailure {
  readonly code: TransformerErrorCode;
  readonly stage: State;
  readonly message: string;
  /** Describes the failure; it does not specify retry counts or backoff. */
  readonly retryable: boolean;
  readonly issues?: readonly ValidationIssue[];
}
