import type { MessageDto } from '../tg-realtime/types.js';
import type { Channel, MediaItem, ParsedMessage } from '../types.js';

/** "-1004386601723", "https://web.telegram.org/a/#-1004386601723" -> -1004386601723 */
export function extractNumericId(input: string): number | null {
  const m = input.trim().match(/^(?:.*#)?(-?\d{5,})$/);
  return m ? Number(m[1]) : null;
}

/** Marked channel id (-100123) -> "123", used for t.me/c/123/<msg> links. */
export const privateLinkId = (chatId: number): string | null => {
  const s = String(chatId);
  return s.startsWith('-100') ? s.slice(4) : null;
};

const MEDIA_TYPES: Record<string, MediaItem['type']> = {
  photo: 'photo', video: 'video', voice: 'audio', audio: 'audio', document: 'document',
};

export function toParsedMessage(dto: MessageDto, channel: Pick<Channel, 'id' | 'username'>): ParsedMessage {
  const priv = privateLinkId(dto.chatId);
  const url = priv && /^c\d+$/.test(channel.username)
    ? `https://t.me/c/${priv}/${dto.messageId}`
    : `https://t.me/${channel.username}/${dto.messageId}`;
  return {
    messageId: dto.messageId,
    postedAt: new Date(dto.date),
    text: dto.text || null,
    views: dto.metrics.views,
    media: dto.media
      ? [{
          type: MEDIA_TYPES[dto.media.kind] ?? 'other',
          url: `/api/media/${channel.id}/${dto.messageId}`,
          fileName: dto.media.fileName,
          mimeType: dto.media.mimeType,
          sizeBytes: dto.media.sizeBytes,
        }]
      : [],
    links: [],
    forwardedFrom: null,
    edited: dto.isEdit || dto.editDate !== null,
    url,
    senderId: dto.senderId,
    senderName: dto.senderName,
    forwards: dto.metrics.forwards,
    reactions: dto.metrics.reactions,
  };
}
