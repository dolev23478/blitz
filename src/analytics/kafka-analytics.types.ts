export type KafkaStreamEventType = 'kafka_published' | 'filter_rejected';

export interface KafkaPublishedEvent {
  type: 'kafka_published';
  id: string;
  channel: string;
  source: 'telegram' | 'x' | 'manual' | string;
  content: string;
  reportId?: number | string;
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

export interface KafkaAnalyticsSummary {
  totalPublished: number;
  totalRejected: number;
  totalProcessed: number;
  overallAcceptanceRate: number; // 0 - 100 percentage
  overallRejectionRate: number; // 0 - 100 percentage
  channels: Record<string, ChannelAnalytics>;
  topPublishingChannels: Array<{
    channel: string;
    source: string;
    count: number;
    percentage: number;
  }>;
  topFailingChannels: Array<{
    channel: string;
    source: string;
    rejectedCount: number;
    totalFetched: number;
    failureRate: number;
  }>;
  distribution: Array<{
    name: string;
    value: number;
    percentage: number;
  }>;
  recentEvents: KafkaStreamEvent[];
  timeSeries: Array<{
    timestamp: string;
    published: number;
    rejected: number;
  }>;
}
