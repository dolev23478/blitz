/**
 * RAW_REPORT as written in schemas.html (20.10.2026), kept independent of the transformer's own
 * provisional schema so the test catches gaps between our output and the DE document.
 * Replace with the DE JSON Schema file once DE shares it.
 */
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';

const string = { type: 'string' };
const stringArray = { type: 'array', items: string };
const utc = { type: 'string', format: 'date-time', pattern: 'Z$' };

export const rawReportContract = {
  type: 'object',
  additionalProperties: false,
  required: [
    'report_id',
    'schema_version',
    'is_official',
    'platform',
    'account_name',
    'channel_name',
    'report_url',
    'media_type',
    'report_title',
    'content',
    'languages',
    'matches',
    'categories',
    'published_at',
    'collected_at',
  ],
  properties: {
    report_id: { type: 'integer', minimum: 0, maximum: 2147483647 },
    schema_version: { type: 'integer' },
    is_official: { const: false },
    platform: { type: 'string', minLength: 1 },
    account_name: string,
    channel_name: { type: ['string', 'null'] },
    report_url: { type: 'string', minLength: 1 },
    media_type: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { enum: ['text', 'photo', 'video'] },
    },
    report_title: { type: ['string', 'null'] },
    content: { type: 'string', minLength: 1, pattern: '\\S' },
    languages: {
      type: 'array',
      items: { type: 'string', pattern: '^[a-z]{2}$' },
    },
    matches: stringArray,
    categories: stringArray,
    published_at: { anyOf: [utc, { type: 'null' }] },
    collected_at: utc,
  },
} as const;

const ajv = new Ajv({ allErrors: true });
addFormats.default(ajv);
const validate = ajv.compile(rawReportContract);

/** Contract problems as readable lines, e.g. "/content: must be string". */
export function contractProblems(report: unknown): string[] {
  if (validate(report)) return [];
  return (validate.errors ?? []).map(
    (e) =>
      `${e.instancePath || '/'}: ${e.message}${e.params && 'additionalProperty' in e.params ? ` (${e.params.additionalProperty})` : ''}`,
  );
}
