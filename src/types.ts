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
  language?: string;
  matches?: string[];
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

export interface DictionaryEntry {
  term: string;
  concept?: string;
  extra?: Record<string, unknown>;
}

export interface IndexedTerm {
  term: string;
  concept?: string;
  sourceFile: string;
  language: string;
}

export interface DictionaryLoadIssue {
  fileName: string;
  message: string;
}

export interface AnalyzeIssue {
  code: string;
  message: string;
}

export interface AnalyzeMatch {
  term: string;
  concept?: string;
  sourceFile: string;
  normalizedTerm: string;
  tokenStart: number;
  tokenEnd: number;
}

export interface AnalyzeTextResult {
  text: string;
  content: string;
  language: string;
  languages?: string[];
  matched: boolean;
  terms: string[];
  matches: AnalyzeMatch[];
  usedSources: string[];
  issues: AnalyzeIssue[];
}

export interface AnalyzeTextOptions {
  /**
   * Override dictionary location. Defaults to DICTIONARIES_DIR or <cwd>/dictionaries.
   * Useful when this module is later mounted inside a larger application.
   */
  dictionariesDir?: string;

  /**
   * Filter matches by concept prefix (e.g. ['violence', 'intent.threat']).
   * If provided, only matches with matching concepts are returned.
   */
  concepts?: string[];

  /**
   * Cap on the number of matches to return per text.
   */
  maxMatches?: number;
}
