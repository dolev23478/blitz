import { TransformerErrorCode } from './enums.js';

export class TransformerException extends Error {
  constructor(
    public readonly code: TransformerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TransformerException';
  }
}
