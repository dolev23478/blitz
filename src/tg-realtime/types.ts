export interface ReactionDto {
  /** Unicode emoji, or "custom:<id>" for custom emoji, or "paid" */
  emoji: string;
  count: number;
}

export interface MetricsDto {
  views: number | null;
  forwards: number | null;
  reactions: ReactionDto[];
  commentsCount: number | null;
}

export type MediaKind =
  | 'photo' | 'video' | 'voice' | 'audio' | 'document' | 'sticker' | 'other';

export interface MediaDto {
  kind: MediaKind;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

export interface MessageDto {
  chatId: number;
  chatTitle: string | null;
  messageId: number;
  /** ISO timestamp */
  date: string;
  editDate: string | null;
  /** true when produced by an edit update */
  isEdit: boolean;
  senderId: number | null;
  senderName: string | null;
  text: string;
  metrics: MetricsDto;
  media: MediaDto | null;
}

export interface MemberDto {
  id: number;
  username: string | null;
  displayName: string;
  bio: string | null;
  status: string;
  isBot: boolean;
  isAdmin: boolean;
  /** Admin rights that are granted (names of true flags); empty for non-admins */
  adminRights: string[];
}
