import type { PayloadFormat } from '../common/enums.js';
import type { JsonValue } from '../common/utils.js';
import type { RawReport } from './schema.js';

/** Trusted configuration only; rules never come from collected payloads. */
export type MappingRule =
  | { kind: 'path'; path: (string | number)[] }
  | { kind: 'literal'; value: JsonValue }
  | {
      kind: 'selector';
      selector: string;
      read: { kind: 'text' } | { kind: 'attribute'; name: string };
      cardinality: 'first' | 'all';
    };

export interface MappingDefinition {
  id: string;
  version: string;
  source: { id: string; version: string };
  format: PayloadFormat;
  // is_official and schema_version are set centrally, not from mapping rules.
  fields: Partial<Record<keyof RawReport, MappingRule>>;
}
