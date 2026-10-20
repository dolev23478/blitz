import type { InputPeerLike, Message, TelegramClient } from '@mtcute/node';
import { mapMember, mapMessage } from '../mappers.js';
import type { MemberDto, MessageDto } from '../types.js';
import { sleepRandom, withFloodWait } from '../utils/resilience.js';

export interface ExtractorOptions {
  scanDelayMinMs: number;
  scanDelayMaxMs: number;
}

/** Active (pull) extraction. Every request is flood-safe and paced. */
export class ExtractorService {
  constructor(
    private readonly client: TelegramClient,
    private readonly opts: ExtractorOptions,
  ) {}

  private call<T>(fn: () => Promise<T>): Promise<T> {
    return withFloodWait(fn, {
      onWait: (s) => console.warn(`FLOOD_WAIT: sleeping exactly ${s}s`),
    });
  }

  private pause(): Promise<void> {
    return sleepRandom(this.opts.scanDelayMinMs, this.opts.scanDelayMaxMs);
  }

  /**
   * Messages posted at or after `since`. Telegram returns them newest first.
   */
  async getHistory(chat: InputPeerLike, since: Date, maxMessages = 5000): Promise<MessageDto[]> {
    const out: MessageDto[] = [];
    let offset: { id: number; date: number } | undefined;
    while (out.length < maxMessages) {
      const page = await this.call(() => this.client.getHistory(chat, { limit: 100, offset }));
      if (page.length === 0) break;
      for (const m of page) {
        if (m.date < since) return out;
        out.push(mapMessage(m, false));
      }
      offset = page.next;
      if (!offset) break;
      await this.pause();
    }
    return out;
  }

  /** Comments (discussion thread) of a channel post. */
  async getComments(chat: InputPeerLike, postId: number, maxComments = 1000): Promise<MessageDto[]> {
    const root = await this.call(() => this.client.getDiscussionMessage({ chatId: chat, message: postId }));
    if (!root) return [];
    const out: MessageDto[] = [];
    let offset: number | undefined;
    while (out.length < maxComments) {
      const page = await this.call(() =>
        this.client.searchMessages({ chatId: root.chat.id, threadId: root.id, query: '', limit: 100, offset }),
      );
      if (page.length === 0) break;
      for (const m of page) out.push(mapMessage(m, false));
      if (!page.next) break;
      offset = page.next;
      await this.pause();
    }
    return out;
  }

  /** Group members including bio (one extra request per member) and admin rights. */
  async getMembers(chat: InputPeerLike, withBio = true, max = 10000): Promise<MemberDto[]> {
    const out: MemberDto[] = [];
    let offset = 0;
    while (out.length < max) {
      const page = await this.call(() => this.client.getChatMembers(chat, { offset, limit: 200 }));
      if (page.length === 0) break;
      for (const m of page) {
        let bio: string | null = null;
        if (withBio) {
          await this.pause();
          bio = await this.call(() => this.client.getFullUser(m.user.id))
            .then((u) => u.bio || null)
            .catch(() => null);
        }
        out.push(mapMember(m, bio));
      }
      offset += page.length;
      if (offset >= page.total) break;
      await this.pause();
    }
    return out;
  }

  /** Downloads the media of one message (by chat + message id) into memory; null if it has none. */
  async downloadMessageMedia(chat: InputPeerLike, messageId: number): Promise<{ data: Uint8Array; mimeType: string | null } | null> {
    const [msg] = await this.call(() => this.client.getMessages(chat, [messageId]));
    if (!msg) return null;
    const data = await this.downloadMedia(msg);
    if (!data) return null;
    const mime = (msg.media as unknown as { mimeType?: unknown } | null)?.mimeType;
    return { data, mimeType: typeof mime === 'string' ? mime : msg.media?.type === 'photo' ? 'image/jpeg' : null };
  }

  /** Helper for downloading the media of a message into memory (or a file path). */
  async downloadMedia(msg: Message, toFile?: string): Promise<Uint8Array | null> {
    const media = msg.media;
    if (!media || !('fileId' in media)) return null;
    if (toFile) {
      await this.call(() => this.client.downloadToFile(toFile, media));
      return null;
    }
    return this.call(() => this.client.downloadAsBuffer(media));
  }
}
