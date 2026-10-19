import type { PayloadFormat } from '../common/enums.js';

/** Input passed directly by another service in this application. */
export interface CollectorInput {
  inputId: string;
  source: {
    id: string;
    version: string;
    platform: string;
  };
  payload: {
    format: PayloadFormat;
    data: unknown;
  };
}
