export enum State {
  Parsing = 'parsing',
  Mapping = 'mapping',
  Validation = 'validation',
  Publishing = 'publishing',
  Completion = 'completion',
  Failed = 'failed',
}

/** Local diagnostic codes. Retry/quarantine policies are decided separately. */
export enum TransformerErrorCode {
  UnsupportedFormat = 'unsupported_format',
  ParsingFailed = 'parsing_failed',
  MappingFailed = 'mapping_failed',
  ValidationFailed = 'validation_failed',
  PublicationFailed = 'publication_failed',
}
