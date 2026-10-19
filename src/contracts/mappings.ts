import type { PayloadFormat } from '../common/enums.js';
import type { JsonValue } from '../common/utils.js';
import type { CollectorSource } from './collectors.js';
import type { RawReportField } from './schema.js';

/** Set by the transformer from trusted configuration, not collector mappings. */
export type MappableRawReportField = Exclude<
  RawReportField,
  'is_official' | 'schema_version'
>;

/** Explicit property/index segments, not executable expressions. */
export type FieldPath = readonly (string | number)[];

/** Declarative descriptions only; no mapping evaluator is implemented here. */
export type MappingRule =
  | {
      readonly kind: 'path';
      readonly path: FieldPath;
    }
  | {
      readonly kind: 'literal';
      readonly value: JsonValue;
    }
  | {
      readonly kind: 'selector';
      readonly selector: string;
      readonly read:
        | { readonly kind: 'text' }
        | { readonly kind: 'attribute'; readonly name: string };
      readonly cardinality: 'first' | 'all';
    };

/**
 * Proposed trusted, versioned project asset. Never accept rules from payloads.
 * Select by source shape/version and format, not platform or format alone.
 * Missing fields remain candidates for validation, not implicit default values.
 */
export interface MappingDefinition {
  readonly id: string;
  readonly version: string;
  readonly source: Pick<CollectorSource, 'id' | 'version'>;
  readonly format: PayloadFormat;
  readonly fields: Readonly<
    Partial<Record<MappableRawReportField, MappingRule>>
  >;
}
