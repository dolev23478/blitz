/** IDs and attempt metadata used for processing and logging. */
export interface ProcessingContext {
  inputId: string;
  sourceId: string;
  attempt: number;
  correlationId?: string;
}
