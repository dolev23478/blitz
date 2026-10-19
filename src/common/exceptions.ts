import type { TransformerFailure } from './interfaces.js';

/** Domain/application error, independent of HTTP status codes and Nest filters. */
export class TransformerException extends Error {
  constructor(
    public readonly failure: TransformerFailure,
    options?: ErrorOptions,
  ) {
    super(failure.message, options);
    this.name = 'TransformerException';
  }
}
