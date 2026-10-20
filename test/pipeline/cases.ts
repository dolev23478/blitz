/**
 * Inputs for the end-to-end pipeline test, in the collectors' own formats, with what should
 * reach reports.raw. Add a case by copying one below. Sources and URLs are fake (.invalid).
 *
 * `expect` describes the expected message and is never fed into the pipeline.
 */
import type { NewMessagesEvent } from '../../src/events/message-events.service.js';
import type { ParsedMessage } from '../../src/types.js';
import type {
  ProfileScrapeResult,
  ScrapedPost,
} from '../../src/x-scraper/contracts/x-scraper.interfaces.js';

export type Expectation =
  | { sent: false; why: string }
  | {
      sent: true;
      /** ISO 639-1 codes that must appear in `languages`. */
      languages: string[];
      /** Dictionary terms that must appear in `matches`. */
      matches: string[];
      /** Terms that must NOT appear (e.g. a term from another post in the same batch). */
      notMatches?: string[];
      /** Exact `media_type`, when the case is about media. */
      mediaType?: string[];
    };

export interface TelegramCase {
  id: string;
  title: string;
  message: ParsedMessage;
  expect: Expectation;
}

export interface XCase {
  id: string;
  title: string;
  /** One X cycle: every post in it goes through the same scrapeBatch result. */
  posts: { post: ScrapedPost; expect: Expectation }[];
}

const CHANNEL = 'blitz_fixture_channel';

function tg(
  id: number,
  text: string | null,
  extra: Partial<ParsedMessage> = {},
): ParsedMessage {
  return {
    messageId: id,
    postedAt: new Date(`2026-10-20T08:${String(id % 60).padStart(2, '0')}:00Z`),
    text,
    views: null,
    media: [],
    links: [],
    forwardedFrom: null,
    edited: false,
    url: `https://t.me/${CHANNEL}/${id}`,
    senderName: 'Fixture Channel',
    ...extra,
  };
}

function x(
  id: string,
  text: string,
  extra: Partial<ScrapedPost> = {},
): ScrapedPost {
  return {
    id,
    url: `https://x.com/fixture_account/status/${id}`,
    authorHandle: 'fixture_account',
    authorName: 'Fixture Account',
    text,
    publishedAt: '2026-10-20T09:00:00.000Z',
    metrics: { replies: 0, retweets: 0, likes: 0, views: 0, bookmarks: 0 },
    media: [],
    isRetweet: false,
    isPinned: false,
    ...extra,
  };
}

export const telegramCases: TelegramCase[] = [
  {
    id: 'tg-he-pigua',
    title: 'Hebrew with "פיגוע" is sent with he and the term',
    message: tg(1001, 'דיווח ראשוני: בוצע פיגוע דקירה בצומת, יש פצועים'),
    expect: { sent: true, languages: ['he'], matches: ['פיגוע'] },
  },
  {
    id: 'tg-he-several-terms',
    title: 'Hebrew with several terms keeps all of them',
    message: tg(1002, 'אזעקה בדרום, דיווח על נפילת טיל בשטח פתוח'),
    expect: { sent: true, languages: ['he'], matches: ['אזעקה', 'טיל'] },
  },
  {
    id: 'tg-he-no-term',
    title: 'Hebrew without any term is filtered out',
    message: tg(1003, 'מתכון לעוגת שוקולד בלי אפייה, מוכנה תוך עשרים דקות'),
    expect: { sent: false, why: 'no dictionary term' },
  },
  {
    id: 'tg-en-everyday-words',
    title: 'Everyday English ("nice day") is filtered out',
    message: tg(1010, 'Good morning everyone, have a nice day'),
    expect: { sent: false, why: 'no threat term; "day" must not count as one' },
  },
  {
    id: 'tg-ar-explosion',
    title: 'Arabic with "انفجار" is sent with ar',
    message: tg(1004, 'انفجار ضخم قرب الميناء مساء اليوم والتفاصيل غير مؤكدة'),
    expect: { sent: true, languages: ['ar'], matches: ['انفجار'] },
  },
  {
    id: 'tg-en-rocket',
    title: 'English with "rocket" is sent with en',
    message: tg(1005, 'A rocket was launched toward the northern city tonight'),
    expect: { sent: true, languages: ['en'], matches: ['rocket'] },
  },
  {
    id: 'tg-mixed-he-en',
    title: 'Mostly Hebrew with English keeps he',
    message: tg(
      1006,
      'פיגוע ירי בכניסה לעיר, לפי דיווחים ראשונים. Source: local police',
    ),
    expect: { sent: true, languages: ['he'], matches: ['פיגוע'] },
  },
  {
    id: 'tg-photo-video',
    title: 'Photo and video map to media_type text, photo, video',
    message: tg(1007, 'תיעוד מהשטח: פיגוע בתחנת האוטובוס', {
      media: [
        { type: 'photo', url: '' },
        { type: 'video', url: '' },
      ],
    }),
    expect: {
      sent: true,
      languages: ['he'],
      matches: ['פיגוע'],
      mediaType: ['text', 'photo', 'video'],
    },
  },
  {
    id: 'tg-document',
    title: 'A document is not a RAW_REPORT media type',
    message: tg(1008, 'מסמך שהופץ אחרי הפיגוע', {
      media: [{ type: 'document', url: '' }],
    }),
    expect: {
      sent: true,
      languages: ['he'],
      matches: ['פיגוע'],
      mediaType: ['text'],
    },
  },
  {
    id: 'tg-photo-no-text',
    title: 'A photo without text is never sent (content is required)',
    message: tg(1009, null, { media: [{ type: 'photo', url: '' }] }),
    expect: { sent: false, why: 'no content' },
  },
];

export const xCases: XCase[] = [
  {
    id: 'x-en-explosion',
    title: 'English post with "explosion"',
    posts: [
      {
        post: x(
          '1980000000000000001',
          'Huge explosion reported near the port, no official statement yet',
        ),
        expect: { sent: true, languages: ['en'], matches: ['explosion'] },
      },
    ],
  },
  {
    id: 'x-he-pigua',
    title: 'Hebrew post with "פיגוע"',
    posts: [
      {
        post: x('1980000000000000002', 'פיגוע דריסה בצומת הכניסה, כוחות בדרך'),
        expect: { sent: true, languages: ['he'], matches: ['פיגוע'] },
      },
    ],
  },
  {
    id: 'x-no-term',
    title: 'Post without any term is filtered out',
    posts: [
      {
        post: x(
          '1980000000000000003',
          'The local football club won the regional cup after extra time',
        ),
        expect: { sent: false, why: 'no dictionary term' },
      },
    ],
  },
  {
    id: 'x-two-languages-one-cycle',
    title: 'Two posts in one cycle keep their own language and terms',
    posts: [
      {
        post: x(
          '1980000000000000004',
          'Rocket fired at the coastal town this morning',
        ),
        expect: {
          sent: true,
          languages: ['en'],
          matches: ['rocket'],
          notMatches: ['صاروخ'],
        },
      },
      {
        post: x(
          '1980000000000000005',
          'سقوط صاروخ في منطقة مفتوحة شمال المدينة',
        ),
        expect: {
          sent: true,
          languages: ['ar'],
          matches: ['صاروخ'],
          notMatches: ['rocket'],
        },
      },
    ],
  },
  {
    id: 'x-animated-gif',
    title: 'An animated GIF counts as video (on X a GIF is a video file)',
    posts: [
      {
        post: x('1980000000000000006', 'Explosion caught on camera', {
          media: [
            {
              type: 'animated_gif',
              url: 'https://fixtures.blitz.invalid/m.gif',
            },
          ],
        }),
        expect: {
          sent: true,
          languages: ['en'],
          matches: ['explosion'],
          mediaType: ['text', 'video'],
        },
      },
    ],
  },
];

export function telegramEvent(messages: ParsedMessage[]): NewMessagesEvent {
  return {
    channelId: 1,
    channel: CHANNEL,
    inserted: messages.length,
    messages,
  };
}

export function xResult(posts: ScrapedPost[]): ProfileScrapeResult {
  return {
    handle: 'x-monitor',
    scrapedAt: '2026-10-20T09:05:00.000Z',
    providerUsed: 'fixture',
    totalPosts: posts.length,
    posts,
  };
}
