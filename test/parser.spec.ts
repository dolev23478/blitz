import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseChannelPage, parseViews } from '../src/scraper/parser.js';
import { NumericChannelIdError, normalizeUsername } from '../src/scraper/username.js';

const html = readFileSync(new URL('./fixtures/durov.html', import.meta.url), 'utf8');

describe('parseViews', () => {
  it.each([
    ['834', 834],
    ['1.2K', 1200],
    ['5.82M', 5_820_000],
    ['', null],
    ['abc', null],
  ])('%s -> %s', (raw, expected) => expect(parseViews(raw)).toBe(expected));
});

describe('parseChannelPage', () => {
  const page = parseChannelPage(html);

  it('extracts channel title and messages sorted by id', () => {
    expect(page.title).toBe('Pavel Durov');
    expect(page.messages.length).toBeGreaterThan(5);
    const ids = page.messages.map((m) => m.messageId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('parses core fields of every message', () => {
    for (const m of page.messages) {
      expect(m.url).toBe(`https://t.me/durov/${m.messageId}`);
      expect(Number.isNaN(m.postedAt.getTime())).toBe(false);
      expect(m.views).toBeGreaterThan(0);
    }
  });

  it('extracts text with line breaks, media, links, edits and forwards', () => {
    expect(page.messages.some((m) => m.text?.includes('\n'))).toBe(true);
    expect(page.messages.some((m) => m.media.some((x) => x.type === 'photo' && x.url.startsWith('https://')))).toBe(true);
    expect(page.messages.some((m) => m.media.some((x) => x.type === 'video'))).toBe(true);
    expect(page.messages.some((m) => m.links.includes('https://telegram.org/safety'))).toBe(true);
    expect(page.messages.some((m) => m.edited)).toBe(true);
    expect(page.messages.some((m) => m.forwardedFrom)).toBe(true);
  });
});

describe('normalizeUsername', () => {
  it.each([
    ['durov', 'durov'],
    ['@Durov', 'durov'],
    ['https://t.me/durov', 'durov'],
    ['t.me/s/durov/123', 'durov'],
    ['https://t.me/+abcdef', null],
    ['https://web.telegram.org/a/#@Durov', 'durov'],
    ['web.telegram.org/k/#@durov', 'durov'],
    ['ab', null],
  ])('%s -> %s', (input, expected) => expect(normalizeUsername(input)).toBe(expected));

  it('rejects numeric web.telegram.org ids with a helpful error', () => {
    expect(() => normalizeUsername('https://web.telegram.org/a/#-1003167552405')).toThrow(NumericChannelIdError);
  });
});
