import { Injectable } from '@nestjs/common';
import type { ParsedMessage } from '../types.js';

export interface NewMessagesEvent {
  channelId: number;
  channel: string;
  inserted: number;
  messages?: ParsedMessage[];
  /** Downloads the photo of one message of this channel; only called for messages that matched. */
  downloadPhoto?: (messageId: number) => Promise<{ data: Uint8Array; mimeType: string | null } | null>;
}

/** In-process bus between the Telegram collector and its listeners; emit() resolves once every listener finished. */
@Injectable()
export class MessageEventsService {
  private readonly listeners = new Set<(event: NewMessagesEvent) => void | Promise<void>>();

  /** Resolves when all listeners are done and rejects if any of them failed. */
  async emit(event: NewMessagesEvent): Promise<void> {
    const results = await Promise.allSettled([...this.listeners].map((listener) => listener(event)));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  }

  /** Subscribes to new-message events; returns an unsubscribe function. */
  subscribe(listener: (event: NewMessagesEvent) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
