import { EventEmitter } from 'node:events';
import { Injectable } from '@nestjs/common';
import type { ParsedMessage } from '../types.js';

export interface NewMessagesEvent {
  channelId: number;
  channel: string;
  inserted: number;
  messages?: ParsedMessage[];
}

/** In-process event bus used to push collector updates to connected clients (SSE). */
@Injectable()
export class MessageEventsService {
  private readonly emitter = new EventEmitter<{ messages: [NewMessagesEvent] }>();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit(event: NewMessagesEvent): void {
    this.emitter.emit('messages', event);
  }

  /** Subscribes to new-message events; returns an unsubscribe function. */
  subscribe(listener: (event: NewMessagesEvent) => void): () => void {
    this.emitter.on('messages', listener);
    return () => void this.emitter.off('messages', listener);
  }
}
