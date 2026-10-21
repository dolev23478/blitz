import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pauses = vi.hoisted(() => [] as [number, number][]);
vi.mock('../../src/tg-realtime/utils/resilience.js', async (orig) => ({
  ...(await orig<typeof import('../../src/tg-realtime/utils/resilience.js')>()),
  sleepRandom: async (min: number, max: number) => void pauses.push([min, max]),
}));
vi.mock('../../src/tg-realtime/mappers.js', () => ({
  mapMessage: (m: { id: number; date: Date }) => ({ messageId: m.id, date: m.date.toISOString() }),
}));
vi.mock('../../src/telegram/telegram.mapper.js', () => ({ toParsedMessage: (dto: unknown) => dto }));

const { ExtractorService } = await import('../../src/tg-realtime/services/extractorService.js');
const { TelegramService } = await import('../../src/telegram/telegram.service.js');

const T0 = Date.UTC(2026, 0, 1, 10, 0, 0);
const iso = (n: number) => new Date(T0 + n * 1000).toISOString();

/** Fake Telegram history that follows getHistory({ reverse: true }) semantics: oldest first from an offset. */
function fakeClient(count: number) {
  const all = Array.from({ length: count }, (_, i) => ({ id: i + 1, date: new Date(T0 + (i + 1) * 1000) }));
  const requests: unknown[] = [];
  return {
    requests,
    client: {
      async getHistory(_chat: unknown, p: { limit: number; offset: { id: number; date: number }; reverse: boolean }) {
        requests.push(p.offset);
        const from = p.offset.id
          ? all.findIndex((m) => m.id >= p.offset.id)
          : all.findIndex((m) => m.date.getTime() / 1000 >= p.offset.date);
        const msgs = from < 0 ? [] : all.slice(from, from + p.limit);
        const last = msgs[msgs.length - 1];
        return Object.assign(msgs, { next: last ? { id: last.id + 1, date: last.date.getTime() / 1000 } : undefined });
      },
    },
  };
}

describe('ExtractorService.historyPages', () => {
  beforeEach(() => void (pauses.length = 0));

  it('streams oldest first in pages with a 200-500ms pause between requests, until Telegram has nothing newer', async () => {
    const { client, requests } = fakeClient(250);
    const extractor = new ExtractorService(client as never, { scanDelayMinMs: 0, scanDelayMaxMs: 0 });
    const pages: number[][] = [];
    for await (const page of extractor.historyPages(1, new Date(T0), 100)) pages.push(page.map((m) => m.messageId));

    expect(pages.map((p) => p.length)).toEqual([100, 100, 50]);
    expect(pages.flat()).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(pauses).toHaveLength(3); // between every two requests
    expect(pauses.every(([min, max]) => min === 200 && max === 500)).toBe(true);
    expect(requests).toHaveLength(4); // the last request returns empty and ends the stream
  });

  it('starts at the given time', async () => {
    const { client } = fakeClient(50);
    const extractor = new ExtractorService(client as never, { scanDelayMinMs: 0, scanDelayMaxMs: 0 });
    const first: number[] = [];
    for await (const page of extractor.historyPages(1, new Date(T0 + 41 * 1000), 100)) first.push(...page.map((m) => m.messageId));
    expect(first[0]).toBe(41);
    expect(first).toHaveLength(10);
  });
});

describe('TelegramService.pullChat', () => {
  function build(cursorDate: string | null, pages: { messageId: number; date: string }[][], failOnPublish?: number) {
    const saved: string[] = [];
    const published: number[][] = [];
    let pulled = 0;
    const redis = {
      isEnabled: () => true,
      get: async () => (cursorDate ? JSON.stringify({ channelId: 1, channel: 'chan', messageId: 1, date: cursorDate }) : null),
      eval: async (_s: string, _k: string[], args: string[]) => void saved.push(args[1]!),
    };
    const events = {
      emit: async (e: { messages: { metadata?: unknown }[] }) => {
        published.push(e.messages.map((_, i) => i));
        if (failOnPublish === published.length) throw new Error('listener failed');
      },
    };
    const svc = new TelegramService({ TG_API_ID: 1, TG_API_HASH: 'x' } as never, events as never, redis as never) as unknown as Record<string, unknown>;
    svc.extractor = {
      async *historyPages() {
        for (const page of pages) {
          pulled++;
          yield page;
        }
      },
    };
    (svc.usernameByChatId as Map<number, string>).set(1, 'chan');
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    return { svc, saved, published, pulled: () => pulled, run: () => (svc.pullChat as (id: number) => Promise<boolean>).call(svc, 1) };
  }
  const msg = (id: number, n: number) => ({ messageId: id, date: iso(n) });

  it('commits the cursor after every page', async () => {
    const t = build(null, [[msg(1, 1), msg(2, 2)], [msg(3, 3)]]);
    expect(await t.run()).toBe(true);
    expect(t.saved).toEqual([iso(2), iso(3)]);
  });

  it('stops without publishing when the newest message of a page precedes the cursor', async () => {
    const t = build(iso(10), [[msg(1, 1), msg(2, 5)], [msg(3, 20)]]);
    await t.run();
    expect(t.published).toHaveLength(0);
    expect(t.saved).toHaveLength(0);
    expect(t.pulled()).toBe(1);
  });

  it('handles a page that ends exactly on the cursor once (dedupe covers the repeats) and then stops', async () => {
    const t = build(iso(10), [[msg(7, 10)], [msg(8, 20)]]);
    await t.run();
    expect(t.published).toHaveLength(1);
    expect(t.pulled()).toBe(1);
  });

  it('keeps the last committed page when a later page fails, and reports the chat as not caught up', async () => {
    const t = build(null, [[msg(1, 1)], [msg(2, 2)], [msg(3, 3)]], 2);
    expect(await t.run()).toBe(false);
    expect(t.saved).toEqual([iso(1)]);
  });
});
