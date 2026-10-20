import { describe, expect, it } from 'vitest';
import { analyzeText, getDictionaryStore } from './index.js';
import { fileURLToPath } from 'node:url';

// Keep flow tests independent of additions to the production OSINT dictionaries.
const dictionaryOptions = {
  dictionariesDir: fileURLToPath(
    new URL('../test/fixtures/dictionaries/', import.meta.url),
  ),
};

interface FakeTelegramMessage {
  chatId: number;
  messageId: number;
  text: string;
  senderName?: string | null;
  matchedLanguage?: string;
}

interface FakeTelegramEvent {
  channelId: number;
  channel: string;
  inserted: number;
  messages?: FakeTelegramMessage[];
}

interface FakeXPost {
  id: string;
  url: string;
  authorHandle: string;
  authorName: string;
  text: string;
  publishedAt: string;
  matchedLanguage?: string;
}

interface FakeXResult {
  handle: string;
  scrapedAt: string;
  providerUsed: string;
  totalPosts: number;
  posts: FakeXPost[];
}

function filterTelegramMessages(
  event: FakeTelegramEvent,
): Array<FakeTelegramMessage & { matchedLanguage: string }> {
  const supportedLanguages = getDictionaryStore(dictionaryOptions).languages();
  const candidateLanguages = [...new Set([...supportedLanguages, 'em'])];
  const kept: Array<FakeTelegramMessage & { matchedLanguage: string }> = [];

  for (const message of event.messages ?? []) {
    if (!message?.text || !message.text.trim()) continue;

    const analysis = analyzeText(message.text, candidateLanguages, dictionaryOptions);
    if (!analysis.matched || analysis.languages?.length === 0) continue;

    const matchedLanguage = analysis.languages?.[0] ?? analysis.language;
    if (!matchedLanguage) continue;

    kept.push({
      ...message,
      matchedLanguage,
    });
  }

  return kept;
}

function filterXPosts(result: FakeXResult): FakeXPost[] {
  const supportedLanguages = getDictionaryStore(dictionaryOptions).languages();
  const candidateLanguages = [...new Set([...supportedLanguages, 'em'])];
  const kept: FakeXPost[] = [];

  for (const post of result.posts) {
    if (!post.text || !post.text.trim()) continue;

    const analysis = analyzeText(post.text, candidateLanguages, dictionaryOptions);
    if (!analysis.matched || analysis.languages?.length === 0) continue;

    const matchedLanguage = analysis.languages?.[0] ?? analysis.language;
    if (!matchedLanguage) continue;

    kept.push({
      ...post,
      matchedLanguage,
    });
  }

  return kept;
}

describe('fake source flow', () => {
  it('keeps only telegram messages that match a loaded dictionary language', () => {
    const event: FakeTelegramEvent = {
      channelId: 1001,
      channel: 'security-group',
      inserted: 3,
      messages: [
        {
          chatId: 1001,
          messageId: 1,
          text: 'I will KILL the jews with a bomb!!!',
          senderName: 'Alice',
          matchedLanguage: 'en',
        },
        {
          chatId: 1001,
          messageId: 2,
          text: 'Good morning everyone, have a nice day',
          senderName: 'Bob',
          matchedLanguage: 'en',
        },
      ],
    };

    const filtered = filterTelegramMessages(event);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.matchedLanguage).toBe('en');
    expect(filtered[0]?.text).toContain('KILL');
  });

  it('keeps only x posts that match a loaded dictionary language', () => {
    const result: FakeXResult = {
      handle: 'incident_feed',
      scrapedAt: new Date().toISOString(),
      providerUsed: 'fake-provider',
      totalPosts: 3,
      posts: [
        {
          id: 'x-1',
          url: 'https://x.com/t/1',
          authorHandle: 'user1',
          authorName: 'User One',
          text: 'I will KILL the jews with a bomb!!!',
          publishedAt: new Date().toISOString(),
          matchedLanguage: 'en',
        },
        {
          id: 'x-2',
          url: 'https://x.com/t/2',
          authorHandle: 'user2',
          authorName: 'User Two',
          text: 'Weekend plans and coffee',
          publishedAt: new Date().toISOString(),
          matchedLanguage: 'en',
        },
      ],
    };

    const filtered = filterXPosts(result);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.matchedLanguage).toBe('en');
    expect(filtered[0]?.text).toContain('KILL');
  });

  it('keeps the matched language on each accepted source item', () => {
    const telegramFiltered = filterTelegramMessages({
      channelId: 99,
      channel: 'group-a',
      inserted: 1,
      messages: [
        { chatId: 99, messageId: 7, text: 'اقتل', matchedLanguage: 'ar' },
        { chatId: 99, messageId: 8, text: 'hello friend', matchedLanguage: 'en' },
      ],
    });

    const xFiltered = filterXPosts({
      handle: 'group-b',
      scrapedAt: new Date().toISOString(),
      providerUsed: 'fake-provider',
      totalPosts: 2,
      posts: [
        {
          id: 'a',
          url: 'https://x.com/a',
          authorHandle: 'a',
          authorName: 'A',
          text: 'اقتل',
          publishedAt: new Date().toISOString(),
        },
        {
          id: 'b',
          url: 'https://x.com/b',
          authorHandle: 'b',
          authorName: 'B',
          text: 'nice weather',
          publishedAt: new Date().toISOString(),
        },
      ],
    });

    expect(telegramFiltered[0]?.matchedLanguage).toBe('ar');
    expect(xFiltered[0]?.matchedLanguage).toBe('ar');
  });
});
