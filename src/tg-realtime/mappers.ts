import type { Message, MessageMedia, ChatMember } from '@mtcute/node';
import type { MediaDto, MemberDto, MessageDto, MetricsDto, ReactionDto } from './types.js';

export function mapReactions(msg: Message): ReactionDto[] {
  const list = msg.reactions?.reactions ?? [];
  return list.map((r) => ({
    emoji: r.isPaid ? 'paid' : typeof r.emoji === 'string' ? r.emoji : `custom:${r.emoji.toString()}`,
    count: r.count,
  }));
}

export function mapMetrics(msg: Message): MetricsDto {
  return {
    views: msg.views,
    forwards: msg.forwards,
    reactions: mapReactions(msg),
    commentsCount: msg.replies?.hasComments ? msg.replies.count : null,
  };
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Extracts file metadata only; the file itself is fetched via downloadMedia(). */
export function mapMedia(media: MessageMedia): MediaDto | null {
  if (!media) return null;
  const m = media as unknown as Record<string, unknown>;
  const kinds = ['photo', 'video', 'voice', 'audio', 'document', 'sticker'] as const;
  const kind = (kinds as readonly string[]).includes(media.type)
    ? (media.type as (typeof kinds)[number])
    : 'other';
  return {
    kind,
    fileName: str(m.fileName),
    mimeType: str(m.mimeType),
    sizeBytes: num(m.fileSize),
    durationSec: num(m.duration),
    width: num(m.width),
    height: num(m.height),
  };
}

export function mapMessage(msg: Message, isEdit: boolean): MessageDto {
  return {
    chatId: msg.chat.id,
    chatTitle: msg.chat.displayName ?? null,
    messageId: msg.id,
    date: msg.date.toISOString(),
    editDate: msg.editDate?.toISOString() ?? null,
    isEdit,
    senderId: msg.sender?.id ?? null,
    senderName: msg.sender?.displayName ?? null,
    text: msg.text,
    metrics: mapMetrics(msg),
    media: mapMedia(msg.media),
  };
}

export function mapMember(m: ChatMember, bio: string | null): MemberDto {
  const rights = m.permissions
    ? Object.entries(m.permissions)
        .filter(([k, v]) => v === true && k !== '_')
        .map(([k]) => k)
    : [];
  return {
    id: m.user.id,
    username: m.user.username,
    displayName: m.user.displayName,
    bio,
    status: m.status,
    isBot: m.user.isBot,
    isAdmin: m.status === 'creator' || m.status === 'admin',
    adminRights: rights,
  };
}
