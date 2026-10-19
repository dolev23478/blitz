import type { PayloadFormat } from '../common/enums.js';

/**
 * Proposed transformer-side source description, not an agreed Redis envelope.
 * Source IDs distinguish payload shapes even when platform/format are shared.
 */
export interface CollectorSource {
  readonly id: string;
  /** Input shape version; independent of DE's RAW_REPORT schema_version. */
  readonly version: string;
  readonly platform: string;
}

/** JSON can arrive as serialized text or an already-parsed, untrusted value. */
export type CollectorPayload =
  | {
      readonly format: PayloadFormat.Json;
      readonly data: unknown;
    }
  | {
      readonly format: PayloadFormat.Web;
      readonly data: string;
    };

/**
 * Proposed internal input model for the future Redis adapter to produce.
 * No Redis key, Stream ID, consumer group, claim or ACK semantics are assumed.
 * Collector timestamps/language/matches remain in the payload for mapping.
 */
export interface CollectorInput {
  /** Input/correlation identity; this is not the canonical report_id. */
  readonly inputId: string;
  readonly source: CollectorSource;
  readonly payload: CollectorPayload;
}
