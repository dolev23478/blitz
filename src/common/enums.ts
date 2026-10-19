export enum PayloadFormat {
  Json = 'json',
  Web = 'html',
}

export enum State {
  Reading = 'reading',
  Parsing = 'parsing',
  Mapping = 'mapping',
  Validation = 'validation',
  Publishing = 'publishing',
  Completion = 'completion',
}

/** Local diagnostic codes. Retry/quarantine policies are decided separately. */
export enum TransformerErrorCode {
  InvalidInput = 'invalid_input',
  UnsupportedFormat = 'unsupported_format',
  ParsingFailed = 'parsing_failed',
  MappingFailed = 'mapping_failed',
  ValidationFailed = 'validation_failed',
  RedisFailed = 'redis_failed',
  PublicationFailed = 'publication_failed',
}
