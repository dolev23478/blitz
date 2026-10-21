import type { CollectorReportFields } from './contracts/collector-report.js';

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

export interface ParsedMessage extends CollectorReportFields {
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

/**
 * Report categories published in RAW_REPORT.categories. Every dictionary entry belongs to exactly one.
 */
export const ReportCategory = {
  /** פח"ע — terror and hostile activity */
  Terror: 'terror',
  /** חירום אזרחי ורפואי */
  CivilEmergency: 'civil_emergency',
  /** הפרות סדר ואלימות המונית */
  Riots: 'riots',
  /** תלול-מסלול, ירי רקטי ואווירי */
  RocketsAerial: 'rockets_aerial',
} as const;

export type ReportCategoryValue = (typeof ReportCategory)[keyof typeof ReportCategory];

export const REPORT_CATEGORIES: readonly string[] = Object.values(ReportCategory);

export interface DictionaryEntry {
  term: string;
  concept?: string;
  category?: ReportCategoryValue;
  extra?: Record<string, unknown>;
}

export interface IndexedTerm {
  term: string;
  concept?: string;
  category?: ReportCategoryValue;
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
  category?: ReportCategoryValue;
  sourceFile: string;
  normalizedTerm: string;
  tokenStart: number;
  tokenEnd: number;
}

export const ThreatMode = {
  DictionaryOnly: 'dictionary_only',
  CategoryFilter: 'category_filter',
  Smart: 'smart',
  Basic: 'basic',
} as const;

export type ThreatEvaluationMode =
  | (typeof ThreatMode)[keyof typeof ThreatMode]
  | 'dictionary_only'
  | 'category_filter'
  | 'smart'
  | 'basic';

export const ThreatCategory = {
  // Weapon
  WeaponFirearm: 'weapon.firearm',
  WeaponExplosive: 'weapon.explosive',
  WeaponMissileRocket: 'weapon.missile_rocket',
  WeaponDrone: 'weapon.drone',
  WeaponBlade: 'weapon.blade',
  WeaponCbrn: 'weapon.cbrn',
  WeaponAmmunition: 'weapon.ammunition',
  WeaponMilitary: 'weapon.military',
  WeaponGeneral: 'weapon.general',

  // Violence
  ViolenceTerrorism: 'violence.terrorism',
  ViolenceKilling: 'violence.killing',
  ViolenceAssault: 'violence.assault',
  ViolenceKidnapping: 'violence.kidnapping',
  ViolenceExplosion: 'violence.explosion',
  ViolenceArson: 'violence.arson',
  ViolenceTorture: 'violence.torture',
  ViolenceGenocide: 'violence.genocide',
  ViolenceGeneral: 'violence.general',

  // Threat
  ThreatDirect: 'threat.direct',
  ThreatIntimidation: 'threat.intimidation',
  ThreatRetaliation: 'threat.retaliation',
  ThreatAnnihilation: 'threat.annihilation',
  ThreatGeneral: 'threat.general',

  // Target
  TargetIsrael: 'target.israel',
  TargetIsraelLocation: 'target.israel_location',
  TargetIsraelInstitution: 'target.israel_institution',
  TargetJewish: 'target.jewish',
  TargetCivilian: 'target.civilian',
  TargetMilitary: 'target.military',
  TargetInfrastructure: 'target.infrastructure',
  TargetGeneral: 'target.general',

  // Hate
  HateAntisemitism: 'hate.antisemitism',
  HateAntiIsrael: 'hate.anti_israel',
  HateExtremistGroup: 'hate.extremist_group',
  HateDehumanization: 'hate.dehumanization',
  HateSlur: 'hate.slur',
  HateNeonazi: 'hate.neonazi',
  HateGeneral: 'hate.general',

  // Context
  ContextConflict: 'context.conflict',
  ContextAlert: 'context.alert',
  ContextSlang: 'context.slang',
  ContextTemporal: 'context.temporal',
  ContextDualUseMaterial: 'context.dual_use_material',
  ContextGeneral: 'context.general',
} as const;

export type CanonicalThreatCategory =
  (typeof ThreatCategory)[keyof typeof ThreatCategory];

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface ThreatEvaluation {
  mode: 'dictionary_only' | 'category_filter' | 'smart';
  riskScore: number;
  riskLevel: RiskLevel;
  threatCategories: string[];
  flaggedReasons: string[];
  wordCount?: number;
  threatDensity?: number;
}

export interface AnalyzeTextResult {
  text: string;
  content: string;
  language: string;
  languages?: string[];
  matched: boolean;
  terms: string[];
  /** Report categories of the matched terms, in order of first appearance. */
  categories: ReportCategoryValue[];
  matches: AnalyzeMatch[];
  usedSources: string[];
  issues: AnalyzeIssue[];
  evaluation?: ThreatEvaluation;
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

  /**
   * Threat analysis evaluation mode:
   * - 'dictionary_only' (or 'basic'): Default legacy mode. Any dictionary hit -> matched = true.
   * - 'category_filter': Requires confirmed threat domain (weapon, violence, threat, hate).
   *   Neutral/dual-use words alone (e.g. gasoline, today) DO NOT trigger matched = true.
   * - 'smart': Multi-factor risk scoring (0-100) based on category weights and dangerous combinations.
   */
  mode?: ThreatEvaluationMode;

  /**
   * Simple boolean toggle for smart mode.
   * If true, enables 'smart' mode with zero extra configuration.
   */
  smart?: boolean;

  /**
   * Simple boolean toggle for category filter mode.
   * If true, enables 'category_filter' mode.
   */
  filter?: boolean;

  /**
   * Risk threshold score when using 'smart' mode (optional, default: 40).
   */
  threatThreshold?: number;
  /**
   * Alias for threatThreshold (optional, default: 40).
   */
  smartThreshold?: number;
}

export interface FilteredMatch {
  term: string;
  normalized: string;
  start: number;
  end: number;
  category: string;
}

export interface FilteredPost {
  id: string;
  source: 'telegram' | 'x';
  channel: string;
  text: string;
  createdAt: string;
  severity: 'low' | 'medium' | 'high';
  matches: FilteredMatch[];
}

export interface FilteredPostEvent {
  type: 'filtered-post';
  payload: FilteredPost;
}
