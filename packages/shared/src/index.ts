export type Severity = 'low' | 'medium' | 'high';
export type MatchCategory =
  'weapon' | 'violence' | 'threat' | 'terrorism' | 'other';

export interface WarningMatch {
  term: string;
  normalized: string;
  start: number;
  end: number;
  category: MatchCategory;
}

export interface FilteredPost {
  id: string;
  source: 'telegram' | 'x' | 'unknown';
  channel: string;
  channelId?: string | number;
  text: string;
  createdAt: string;
  severity: Severity;
  matches: WarningMatch[];
}

export interface FilteredPostSseEvent {
  type: 'filtered-post';
  payload: FilteredPost;
}

// -------------------------------------------------------------
// Kafka Stream & Filter Analytics Contracts
// -------------------------------------------------------------

export type KafkaStreamEventType = 'kafka_published' | 'filter_rejected';

export interface KafkaPublishedEvent {
  type: 'kafka_published';
  id: string;
  channel: string;
  source: 'telegram' | 'x' | 'manual' | string;
  content: string;
  termsMatched?: string[];
  language?: string;
  timestamp: string;
  topic?: string;
}

export interface FilterRejectedEvent {
  type: 'filter_rejected';
  id: string;
  channel: string;
  source: 'telegram' | 'x' | 'manual' | string;
  content: string;
  reason: string;
  attemptedLanguages?: string[];
  timestamp: string;
}

export type KafkaStreamEvent = KafkaPublishedEvent | FilterRejectedEvent;

export interface ChannelAnalytics {
  channel: string;
  source: string;
  publishedCount: number;
  rejectedCount: number;
  totalFetched: number;
  rejectionRate: number; // 0 - 100 percentage
  acceptanceRate: number; // 0 - 100 percentage
  lastActive: string;
}

export interface ChannelDistributionItem {
  name: string;
  value: number;
  percentage: number;
}

export interface ChannelFailureItem {
  channel: string;
  source: string;
  rejectedCount: number;
  totalFetched: number;
  failureRate: number;
}

export interface TopPublishingChannelItem {
  channel: string;
  source: string;
  count: number;
  percentage: number;
}

export interface KafkaAnalyticsSummary {
  totalPublished: number;
  totalRejected: number;
  totalProcessed: number;
  overallAcceptanceRate: number; // 0 - 100 percentage
  overallRejectionRate: number; // 0 - 100 percentage
  channels: Record<string, ChannelAnalytics>;
  topPublishingChannels: TopPublishingChannelItem[];
  topFailingChannels: ChannelFailureItem[];
  distribution: ChannelDistributionItem[];
  recentEvents: KafkaStreamEvent[];
  timeSeries: Array<{
    timestamp: string;
    published: number;
    rejected: number;
  }>;
}

// -------------------------------------------------------------
// Demo Builders & Mock Data
// -------------------------------------------------------------

export function buildDemoPost(
  overrides: Partial<FilteredPost> = {},
): FilteredPost {
  const now = new Date().toISOString();

  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: overrides.source ?? 'telegram',
    channel: overrides.channel ?? 'front-page-demo',
    channelId: overrides.channelId ?? 'demo-1',
    text:
      overrides.text ??
      'We need to prepare explosives and move to the rooftop before the convoy passes.',
    createdAt: overrides.createdAt ?? now,
    severity: overrides.severity ?? 'high',
    matches: overrides.matches ?? [
      {
        term: 'explosives',
        normalized: 'explosives',
        start: 18,
        end: 28,
        category: 'weapon',
      },
      {
        term: 'rooftop',
        normalized: 'rooftop',
        start: 39,
        end: 46,
        category: 'violence',
      },
    ],
  };
}

export function buildDemoAnalyticsSummary(): KafkaAnalyticsSummary {
  const now = Date.now();
  return {
    totalPublished: 142,
    totalRejected: 89,
    totalProcessed: 231,
    overallAcceptanceRate: 61.5,
    overallRejectionRate: 38.5,
    channels: {
      't.me/military_intel_tg': {
        channel: 't.me/military_intel_tg',
        source: 'telegram',
        publishedCount: 54,
        rejectedCount: 12,
        totalFetched: 66,
        rejectionRate: 18.2,
        acceptanceRate: 81.8,
        lastActive: new Date(now - 15000).toISOString(),
      },
      '@idf_spokesperson': {
        channel: '@idf_spokesperson',
        source: 'x',
        publishedCount: 38,
        rejectedCount: 8,
        totalFetched: 46,
        rejectionRate: 17.4,
        acceptanceRate: 82.6,
        lastActive: new Date(now - 32000).toISOString(),
      },
      't.me/conflict_watch': {
        channel: 't.me/conflict_watch',
        source: 'telegram',
        publishedCount: 31,
        rejectedCount: 29,
        totalFetched: 60,
        rejectionRate: 48.3,
        acceptanceRate: 51.7,
        lastActive: new Date(now - 45000).toISOString(),
      },
      't.me/general_news_hub': {
        channel: 't.me/general_news_hub',
        source: 'telegram',
        publishedCount: 19,
        rejectedCount: 40,
        totalFetched: 59,
        rejectionRate: 67.8,
        acceptanceRate: 32.2,
        lastActive: new Date(now - 80000).toISOString(),
      },
    },
    topPublishingChannels: [
      {
        channel: 't.me/military_intel_tg',
        source: 'telegram',
        count: 54,
        percentage: 38.0,
      },
      {
        channel: '@idf_spokesperson',
        source: 'x',
        count: 38,
        percentage: 26.8,
      },
      {
        channel: 't.me/conflict_watch',
        source: 'telegram',
        count: 31,
        percentage: 21.8,
      },
      {
        channel: 't.me/general_news_hub',
        source: 'telegram',
        count: 19,
        percentage: 13.4,
      },
    ],
    topFailingChannels: [
      {
        channel: 't.me/general_news_hub',
        source: 'telegram',
        rejectedCount: 40,
        totalFetched: 59,
        failureRate: 67.8,
      },
      {
        channel: 't.me/conflict_watch',
        source: 'telegram',
        rejectedCount: 29,
        totalFetched: 60,
        failureRate: 48.3,
      },
      {
        channel: 't.me/military_intel_tg',
        source: 'telegram',
        rejectedCount: 12,
        totalFetched: 66,
        failureRate: 18.2,
      },
      {
        channel: '@idf_spokesperson',
        source: 'x',
        rejectedCount: 8,
        totalFetched: 46,
        failureRate: 17.4,
      },
    ],
    distribution: [
      { name: 't.me/military_intel_tg', value: 54, percentage: 38.0 },
      { name: '@idf_spokesperson', value: 38, percentage: 26.8 },
      { name: 't.me/conflict_watch', value: 31, percentage: 21.8 },
      { name: 't.me/general_news_hub', value: 19, percentage: 13.4 },
    ],
    recentEvents: [
      {
        type: 'kafka_published',
        id: 'pub-1',
        channel: 't.me/military_intel_tg',
        source: 'telegram',
        content:
          'Heavy rocket barrage detected towards central district. Multiple impacts reported.',
        termsMatched: ['rocket barrage', 'impacts'],
        language: 'he',
        timestamp: new Date(now - 15000).toISOString(),
        topic: 'threat-intel-stream',
      },
      {
        type: 'filter_rejected',
        id: 'rej-1',
        channel: 't.me/general_news_hub',
        source: 'telegram',
        content:
          'Stock market indices closed mixed today following quarterly tech earnings.',
        reason: 'Failed threat keyword filter (no qualifying security terms)',
        timestamp: new Date(now - 28000).toISOString(),
      },
      {
        type: 'kafka_published',
        id: 'pub-2',
        channel: '@idf_spokesperson',
        source: 'x',
        content:
          'Air defense systems intercepted 3 UAVs approaching northern border.',
        termsMatched: ['air defense', 'intercepted', 'uav'],
        language: 'en',
        timestamp: new Date(now - 32000).toISOString(),
        topic: 'threat-intel-stream',
      },
      {
        type: 'filter_rejected',
        id: 'rej-2',
        channel: 't.me/conflict_watch',
        source: 'telegram',
        content:
          'Weather forecast calls for light rain and fog across the valley tonight.',
        reason: 'Failed threat keyword filter (no qualifying security terms)',
        timestamp: new Date(now - 45000).toISOString(),
      },
    ],
    timeSeries: [
      {
        timestamp: new Date(now - 300000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        published: 12,
        rejected: 8,
      },
      {
        timestamp: new Date(now - 240000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        published: 18,
        rejected: 14,
      },
      {
        timestamp: new Date(now - 180000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        published: 26,
        rejected: 19,
      },
      {
        timestamp: new Date(now - 120000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        published: 34,
        rejected: 22,
      },
      {
        timestamp: new Date(now - 60000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
        published: 52,
        rejected: 26,
      },
    ],
  };
}
