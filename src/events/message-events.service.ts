import { Injectable } from '@nestjs/common';
import type { ParsedMessage } from '../types.js';

export interface NewMessagesEvent {
  chatId: number;
  channel: string;
  messages: ParsedMessage[];
}

type Listener = (event: NewMessagesEvent) => void;

/** In-process bus carrying collected Telegram messages to the analysis/transform pipeline. */
@Injectable()
export class MessageEventsService {
  private readonly listeners = new Set<Listener>();

  emit(event: NewMessagesEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** Subscribes to new-message events; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
