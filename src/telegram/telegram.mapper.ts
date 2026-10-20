import type { MessageDto } from '../tg-realtime/types.js';
import type { MediaItem, ParsedMessage } from '../types.js';

const MEDIA_TYPES: Record<string, MediaItem['type']> = {
  photo: 'photo', video: 'video', voice: 'audio', audio: 'audio', document: 'document',
};

/** Marked channel id (-100123) -> "123", used for t.me/c/123/<msg> links. */
const privateLinkId = (chatId: number): string | null => {
  const s = String(chatId);
  return s.startsWith('-100') ? s.slice(4) : null;
};

export function toParsedMessage(dto: MessageDto, username: string): ParsedMessage {
  const priv = privateLinkId(dto.chatId);
  return {
    messageId: dto.messageId,
    postedAt: new Date(dto.date),
    text: dto.text || null,
    views: dto.metrics.views,
    media: dto.media ? [{ type: MEDIA_TYPES[dto.media.kind] ?? 'other', url: '', fileName: dto.media.fileName, mimeType: dto.media.mimeType, sizeBytes: dto.media.sizeBytes }] : [],
    links: [],
    forwardedFrom: null,
    edited: dto.isEdit || dto.editDate !== null,
    url: username ? `https://t.me/${username}/${dto.messageId}` : `https://t.me/c/${priv}/${dto.messageId}`,
    senderId: dto.senderId,
    senderName: dto.senderName,
    forwards: dto.metrics.forwards,
    reactions: dto.metrics.reactions,
  };
}
