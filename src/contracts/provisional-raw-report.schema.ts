import {
  REPORT_ID_MIN,
  INT32_MAX,
  IS_OFFICIAL,
  SCHEMA_VERSION,
} from '../common/constants.js';
import { ISO_639_1_CODES } from '../common/languages.js';

/** LOCAL MVP rules only. Replace/reconcile with the actual DE contract. */
export const provisionalRawReportSchema = {
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
    'categories',
    'matches',
    'published_at',
    'collected_at',
  ],
  properties: {
    report_id: {
      type: 'integer',
      minimum: REPORT_ID_MIN,
      maximum: INT32_MAX,
    },
    schema_version: { type: 'integer', const: SCHEMA_VERSION },
    is_official: { const: IS_OFFICIAL },
    platform: { type: 'string', minLength: 1, pattern: '\\S' },
    account_name: { type: ['string', 'null'] },
    channel_name: { type: ['string', 'null'] },
    report_url: { type: 'string', minLength: 1, format: 'uri' },
    media_type: {
      type: 'array',
      items: { type: 'string', enum: ['text', 'photo', 'video'] },
    },
    report_title: { type: ['string', 'null'] },
    media_urls: { type: 'array', items: { type: 'string', minLength: 1, format: 'uri' } },
    content: { type: 'string', minLength: 1, pattern: '\\S' },
    languages: {
      type: 'array',
      items: { type: 'string', enum: ISO_639_1_CODES },
    },
    categories: { type: 'array', items: { type: 'string' } },
    matches: { type: 'array', items: { type: 'string' } },
    published_at: {
      anyOf: [
        { type: 'string', format: 'date-time', pattern: 'Z$' },
        { type: 'null' },
      ],
    },
    collected_at: { type: 'string', format: 'date-time', pattern: 'Z$' },
  },
};
