import { readFile } from 'node:fs/promises';
import type { Sample } from './types.js';

export interface SampleIssue {
  /** Sample id, or `#<index>` when the id itself is missing; `(file)` for file-level problems. */
  sample: string;
  /** Dotted path inside the sample, e.g. `post.media[1].type`. */
  field: string;
  message: string;
}

export interface LoadedSamples {
  valid: Sample[];
  /** Every problem of every invalid sample. Invalid samples are never run. */
  issues: SampleIssue[];
  invalidCount: number;
}

type Issues = [string, string][];
type Rec = Record<string, unknown>;
type Check = (v: unknown) => boolean;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const isObject = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str: Check = (v) => typeof v === 'string' && v.trim() !== '';
const strOrNull: Check = (v) => v === null || typeof v === 'string';
const int: Check = (v) => Number.isSafeInteger(v);
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const numOrNull: Check = (v) => v === null || num(v);
const bool: Check = (v) => typeof v === 'boolean';
const iso: Check = (v) =>
  typeof v === 'string' && ISO_UTC.test(v) && !Number.isNaN(Date.parse(v));
const arr: Check = Array.isArray;
/** Same rule as `str`, separate function so its error message is specific. */
const text: Check = (v) => str(v);

const DESCRIBE = new Map<Check, string>([
  [str, 'non-empty string'],
  [strOrNull, 'string or null'],
  [int, 'integer'],
  [num, 'number'],
  [numOrNull, 'number or null'],
  [bool, 'boolean'],
  [iso, 'ISO 8601 UTC time, e.g. 2026-10-19T08:00:00Z'],
  [arr, 'array'],
  [
    text,
    'non-empty text (RAW_REPORT.content can never be empty, also with media)',
  ],
]);

/** Results of later steps. A post must not carry them: the transformer would use them as is. */
const PROCESSING_FIELDS = new Set([
  'language',
  'matches',
  'report_id',
  'media_type',
  'schema_version',
  'is_official',
  'reality_id',
]);

/** `StoredMessage` (src/types.ts), as the Telegram collector stores it. */
const STORED_MESSAGE: Record<string, Check> = {
  id: int,
  channelId: int,
  channel: str,
  channelTitle: strOrNull,
  messageId: int,
  postedAt: iso,
  text,
  views: numOrNull,
  media: arr,
  links: arr,
  forwardedFrom: strOrNull,
  edited: bool,
  url: str,
  fetchedAt: iso,
};
const STORED_MESSAGE_OPTIONAL: Record<string, Check> = {
  senderId: numOrNull,
  senderName: strOrNull,
  forwards: numOrNull,
  reactions: arr,
};
const TELEGRAM_MEDIA = ['photo', 'video', 'document', 'audio', 'other'];

/** `ProfileScrapeResult` / `ScrapedPost` (src/x-scraper/contracts), as the X collector returns them. */
const PROFILE_RESULT: Record<string, Check> = {
  handle: str,
  scrapedAt: iso,
  providerUsed: str,
  totalPosts: int,
  posts: arr,
};
const SCRAPED_POST: Record<string, Check> = {
  id: str,
  url: str,
  authorHandle: str,
  authorName: str,
  text,
  publishedAt: iso,
  metrics: isObject,
  media: arr,
  isRetweet: bool,
  isPinned: bool,
};
const SCRAPED_POST_OPTIONAL: Record<string, Check> = {
  authorAvatarUrl: str,
  rawHtmlSnippet: str,
};
const METRICS = ['replies', 'retweets', 'likes', 'views', 'bookmarks'];
const X_MEDIA = ['photo', 'video', 'animated_gif'];

function checkFields(
  obj: Rec,
  path: string,
  required: Record<string, Check>,
  optional: Record<string, Check>,
  out: Issues,
): void {
  for (const [key, check] of Object.entries(required)) {
    if (!(key in obj))
      out.push([
        `${path}.${key}`,
        `required ${DESCRIBE.get(check) ?? ''}`.trim(),
      ]);
    else if (!check(obj[key]))
      out.push([`${path}.${key}`, `must be ${DESCRIBE.get(check) ?? 'valid'}`]);
  }
  for (const [key, value] of Object.entries(obj)) {
    if (PROCESSING_FIELDS.has(key)) {
      out.push([
        `${path}.${key}`,
        'computed by the pipeline, not part of collector output (put expected values in "expect")',
      ]);
    } else if (key in optional) {
      if (!optional[key]!(value))
        out.push([
          `${path}.${key}`,
          `must be ${DESCRIBE.get(optional[key]!) ?? 'valid'}`,
        ]);
    } else if (!(key in required)) {
      out.push([`${path}.${key}`, 'unknown field']);
    }
  }
}

function checkMedia(
  media: unknown,
  path: string,
  types: string[],
  out: Issues,
): void {
  if (!Array.isArray(media)) return;
  media.forEach((m, i) => {
    if (!isObject(m))
      return void out.push([`${path}[${i}]`, 'must be an object']);
    if (!types.includes(m.type as string))
      out.push([`${path}[${i}].type`, `must be one of ${types.join(', ')}`]);
    if (!str(m.url))
      out.push([`${path}[${i}].url`, 'required non-empty string']);
  });
}

function checkPost(format: unknown, post: unknown, out: Issues): void {
  if (!isObject(post)) return void out.push(['post', 'required object']);
  if (format === 'StoredMessage') {
    checkFields(post, 'post', STORED_MESSAGE, STORED_MESSAGE_OPTIONAL, out);
    checkMedia(post.media, 'post.media', TELEGRAM_MEDIA, out);
  } else if (format === 'ProfileScrapeResult') {
    checkFields(post, 'post', PROFILE_RESULT, {}, out);
    // One post per sample: language and matches are passed per transformer run, not per post.
    if (!Array.isArray(post.posts) || post.posts.length !== 1) {
      return void out.push([
        'post.posts',
        'must hold exactly one post per sample',
      ]);
    }
    const p = post.posts[0];
    if (!isObject(p))
      return void out.push(['post.posts[0]', 'must be an object']);
    checkFields(p, 'post.posts[0]', SCRAPED_POST, SCRAPED_POST_OPTIONAL, out);
    checkMedia(p.media, 'post.posts[0].media', X_MEDIA, out);
    if (isObject(p.metrics)) {
      for (const m of METRICS)
        if (!num(p.metrics[m]))
          out.push([`post.posts[0].metrics.${m}`, 'required number']);
    }
    if (post.totalPosts !== 1 && int(post.totalPosts))
      out.push(['post.totalPosts', 'must equal the number of posts (1)']);
  }
}

function checkSample(raw: Rec): Issues {
  const out: Issues = [];
  for (const key of Object.keys(raw)) {
    if (!['id', 'tags', 'note', 'format', 'post', 'expect'].includes(key))
      out.push([key, 'unknown field']);
  }
  if (!str(raw.id)) out.push(['id', 'required non-empty string']);
  if (!Array.isArray(raw.tags) || !raw.tags.every(str))
    out.push(['tags', 'required array of non-empty strings']);
  if (raw.note !== undefined && typeof raw.note !== 'string')
    out.push(['note', 'must be a string']);
  if (raw.format !== 'StoredMessage' && raw.format !== 'ProfileScrapeResult') {
    out.push([
      'format',
      'must be StoredMessage (Telegram) or ProfileScrapeResult (X)',
    ]);
  }
  checkPost(raw.format, raw.post, out);

  const exp = raw.expect;
  if (exp !== undefined) {
    if (!isObject(exp)) {
      out.push(['expect', 'must be an object']);
    } else {
      if (
        !['processed', 'filtered', 'duplicate', 'failed'].includes(
          exp.outcome as string,
        )
      ) {
        out.push([
          'expect.outcome',
          'must be one of processed, filtered, duplicate, failed',
        ]);
      }
      if (
        exp.language !== undefined &&
        !(typeof exp.language === 'string' && /^[a-z]{2}$/.test(exp.language))
      ) {
        out.push(['expect.language', 'must be an ISO 639-1 code']);
      }
      if (
        exp.matchesInclude !== undefined &&
        !(Array.isArray(exp.matchesInclude) && exp.matchesInclude.every(str))
      ) {
        out.push([
          'expect.matchesInclude',
          'must be an array of non-empty strings',
        ]);
      }
    }
  }
  return out;
}

/** Validates parsed file content. Pure, so it is tested without files. */
export function validateSamples(content: unknown): LoadedSamples {
  if (!isObject(content) || !Array.isArray(content.samples)) {
    return {
      valid: [],
      issues: [
        {
          sample: '(file)',
          field: 'samples',
          message: 'the file must be an object with a "samples" array',
        },
      ],
      invalidCount: 0,
    };
  }
  const valid: Sample[] = [];
  const issues: SampleIssue[] = [];
  const seen = new Set<string>();
  let invalidCount = 0;

  content.samples.forEach((raw, index) => {
    const name =
      isObject(raw) && str(raw.id) ? (raw.id as string) : `#${index}`;
    const found: Issues = isObject(raw)
      ? checkSample(raw)
      : [['', 'each sample must be an object']];
    if (seen.has(name))
      found.push([
        'id',
        'duplicate sample id in this file (to send the same post twice, use two ids)',
      ]);
    seen.add(name);
    if (found.length) {
      invalidCount++;
      for (const [field, message] of found)
        issues.push({ sample: name, field, message });
    } else {
      valid.push(raw as unknown as Sample);
    }
  });
  return { valid, issues, invalidCount };
}

export async function loadSamples(path: string): Promise<LoadedSamples> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(
      `cannot read samples file ${path}: ${(err as Error).message}`,
    );
  }
  try {
    return validateSamples(JSON.parse(raw));
  } catch (err) {
    throw new Error(
      `samples file ${path} is not valid JSON: ${(err as Error).message}`,
    );
  }
}

/** Samples whose tags include the scenario name, or every sample when no scenario is given. */
export function selectScenario(samples: Sample[], scenario?: string): Sample[] {
  return scenario ? samples.filter((s) => s.tags.includes(scenario)) : samples;
}

/** The post text the filter and language steps read, before the transformer maps it. */
export function postText(sample: Sample): string {
  return sample.format === 'StoredMessage'
    ? ((sample.post as { text: string }).text ?? '')
    : ((sample.post as { posts: { text: string }[] }).posts[0]?.text ?? '');
}
