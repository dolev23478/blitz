import { Dispatcher } from '@mtcute/dispatcher';
import type { Message, TelegramClient } from '@mtcute/node';
import { mapMessage } from '../mappers.js';
import type { MessageDto } from '../types.js';

export type MessageHandler = (dto: MessageDto) => void | Promise<void>;

/** O(1) filter: only messages from chats in the Set are processed. */
export function isTargetChat(ids: ReadonlySet<number>, chatId: number): boolean {
  return ids.has(chatId);
}

/**
 * Registers push listeners (new + edited messages) on a Dispatcher.
 * Updates arrive over the MTProto socket, so latency is network-bound.
 */
export function startMessageListener(
  client: TelegramClient,
  chatIds: ReadonlySet<number>,
  onMessage: MessageHandler,
): Dispatcher {
  const dp = Dispatcher.for(client);

  const handle = (msg: Message, isEdit: boolean): void => {
    if (!isTargetChat(chatIds, msg.chat.id)) return;
    Promise.resolve(onMessage(mapMessage(msg, isEdit))).catch((e) =>
      console.error('message handler failed:', e),
    );
  };

  dp.onNewMessage((msg) => handle(msg, false));
  dp.onEditMessage((msg) => handle(msg, true));
  dp.onError((err) => {
    console.error('dispatcher error:', err);
    return true; // mark handled; never crash the process
  });
  return dp;
}
