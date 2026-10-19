export interface MediaItem {
  type: 'photo' | 'video' | 'document' | 'audio' | 'other';
  url: string;
  thumbnail?: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
}

export interface Reaction {
  emoji: string;
  count: number;
}

export interface ParsedMessage {
  messageId: number;
  postedAt: Date;
  text: string | null;
  views: number | null;
  media: MediaItem[];
  links: string[];
  forwardedFrom: string | null;
  edited: boolean;
  url: string;
  /** Only set for messages collected through the Telegram account (MTProto). */
  senderId?: number | null;
  /** Display name of the sender (Telegram account source only). */
  senderName?: string | null;
  forwards?: number | null;
  reactions?: Reaction[];
}

export interface ChannelPage {
  title: string | null;
  messages: ParsedMessage[];
}

export interface Channel {
  id: number;
  username: string;
  title: string | null;
  active: boolean;
  /** 'web' = public preview scraping, 'mtproto' = Telegram account (groups, private chats) */
  source: 'web' | 'mtproto';
  tgChatId: number | null;
  lastMessageId: number | null;
  backfilledAt: Date | null;
  lastPolledAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface StoredMessage extends ParsedMessage {
  id: number;
  channelId: number;
  channel: string;
  channelTitle: string | null;
  fetchedAt: Date;
}
