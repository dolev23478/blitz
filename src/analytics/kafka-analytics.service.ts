import { EventEmitter } from 'node:events';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  ChannelAnalytics,
  FilterRejectedEvent,
  KafkaAnalyticsSummary,
  KafkaPublishedEvent,
  KafkaStreamEvent,
} from './kafka-analytics.types.js';

@Injectable()
export class KafkaAnalyticsService {
  private readonly logger = new Logger(KafkaAnalyticsService.name);
  private readonly emitter = new EventEmitter<{ event: [KafkaStreamEvent] }>();

  private totalPublished = 0;
  private totalRejected = 0;
  private readonly channelMap = new Map<string, ChannelAnalytics>();
  private readonly recentEventsList: KafkaStreamEvent[] = [];
  private readonly timeBuckets = new Map<string, { published: number; rejected: number }>();

  constructor() {
    this.emitter.setMaxListeners(200);
    this.initializeBaselineData();
  }

  /**
   * Initializes baseline demo / historical data so the dashboard is immediately informative.
   */
  private initializeBaselineData(): void {
    const seedChannels = [
      { name: 'gaza_now_channel', source: 'telegram', published: 48, rejected: 12 },
      { name: 'lebanon_news_front', source: 'telegram', published: 34, rejected: 19 },
      { name: 'osint_middle_east', source: 'x', published: 62, rejected: 8 },
      { name: 'idf_spokesperson', source: 'telegram', published: 29, rejected: 4 },
      { name: 'jenin_brigade_media', source: 'telegram', published: 51, rejected: 37 },
      { name: 'middle_east_observer', source: 'x', published: 41, rejected: 26 },
      { name: 'quds_news_network', source: 'telegram', published: 58, rejected: 31 },
      { name: 'syria_military_wire', source: 'telegram', published: 19, rejected: 22 },
      { name: 'war_monitor_x', source: 'x', published: 45, rejected: 15 },
      { name: 'general_chatter_group', source: 'telegram', published: 3, rejected: 48 },
    ];

    const now = Date.now();
    for (let i = 20; i >= 0; i--) {
      const timeKey = new Date(now - i * 60 * 1000).toISOString().slice(11, 16);
      this.timeBuckets.set(timeKey, {
        published: Math.floor(Math.random() * 8) + 2,
        rejected: Math.floor(Math.random() * 6) + 1,
      });
    }

    for (const ch of seedChannels) {
      const total = ch.published + ch.rejected;
      this.totalPublished += ch.published;
      this.totalRejected += ch.rejected;
      this.channelMap.set(ch.name, {
        channel: ch.name,
        source: ch.source,
        publishedCount: ch.published,
        rejectedCount: ch.rejected,
        totalFetched: total,
        rejectionRate: Number(((ch.rejected / total) * 100).toFixed(1)),
        acceptanceRate: Number(((ch.published / total) * 100).toFixed(1)),
        lastActive: new Date(now - Math.floor(Math.random() * 300000)).toISOString(),
      });
    }

    // Seed a few initial recent events
    this.recentEventsList.push(
      {
        type: 'kafka_published',
        id: randomUUID(),
        channel: 'osint_middle_east',
        source: 'x',
        content: 'Rocket barrage sirens sound across the northern border region following artillery exchange.',
        reportId: 98124,
        termsMatched: ['rocket', 'sirens', 'artillery'],
        language: 'en',
        timestamp: new Date(now - 30000).toISOString(),
        topic: 'raw-reports',
      },
      {
        type: 'filter_rejected',
        id: randomUUID(),
        channel: 'general_chatter_group',
        source: 'telegram',
        content: 'Weather forecast for this evening: partly cloudy with light breeze.',
        reason: 'No threat or violence keywords matched',
        attemptedLanguages: ['ar', 'he', 'en', 'fa'],
        timestamp: new Date(now - 65000).toISOString(),
      },
      {
        type: 'kafka_published',
        id: randomUUID(),
        channel: 'quds_news_network',
        source: 'telegram',
        content: 'דיווח ראשוני על פיצוץ מטען ליד המחסום, כוחות ביטחון הוזעקו לזירה',
        reportId: 98125,
        termsMatched: ['מטען', 'פיצוץ'],
        language: 'he',
        timestamp: new Date(now - 90000).toISOString(),
        topic: 'raw-reports',
      },
    );
  }

  /**
   * Records a successfully published post into Kafka and notifies SSE clients.
   */
  recordPublished(data: Omit<KafkaPublishedEvent, 'type'>): KafkaPublishedEvent {
    const event: KafkaPublishedEvent = {
      ...data,
      type: 'kafka_published',
      id: data.id || randomUUID(),
      timestamp: data.timestamp || new Date().toISOString(),
    };

    this.totalPublished++;
    this.updateChannel(event.channel, event.source, true);
    this.addRecentEvent(event);
    this.updateBucket(event.timestamp, true);

    this.logger.log(`[Kafka Analytics] Published: channel=${event.channel}, id=${event.id}`);
    this.emitter.emit('event', event);
    return event;
  }

  /**
   * Records a post that failed keyword filter criteria and notifies SSE clients.
   */
  recordRejected(data: Omit<FilterRejectedEvent, 'type'>): FilterRejectedEvent {
    const event: FilterRejectedEvent = {
      ...data,
      type: 'filter_rejected',
      id: data.id || randomUUID(),
      timestamp: data.timestamp || new Date().toISOString(),
    };

    this.totalRejected++;
    this.updateChannel(event.channel, event.source, false);
    this.addRecentEvent(event);
    this.updateBucket(event.timestamp, false);

    this.logger.log(`[Kafka Analytics] Filter Rejected: channel=${event.channel}, reason=${event.reason}`);
    this.emitter.emit('event', event);
    return event;
  }

  /**
   * Updates channel-level metrics.
   */
  private updateChannel(channel: string, source: string, published: boolean): void {
    const existing = this.channelMap.get(channel) ?? {
      channel,
      source: source || 'unknown',
      publishedCount: 0,
      rejectedCount: 0,
      totalFetched: 0,
      rejectionRate: 0,
      acceptanceRate: 0,
      lastActive: new Date().toISOString(),
    };

    if (published) {
      existing.publishedCount++;
    } else {
      existing.rejectedCount++;
    }
    existing.totalFetched++;
    existing.rejectionRate = Number(((existing.rejectedCount / existing.totalFetched) * 100).toFixed(1));
    existing.acceptanceRate = Number(((existing.publishedCount / existing.totalFetched) * 100).toFixed(1));
    existing.lastActive = new Date().toISOString();

    this.channelMap.set(channel, existing);
  }

  private addRecentEvent(event: KafkaStreamEvent): void {
    this.recentEventsList.unshift(event);
    if (this.recentEventsList.length > 200) {
      this.recentEventsList.pop();
    }
  }

  private updateBucket(timestampIso: string, published: boolean): void {
    const timeKey = timestampIso.slice(11, 16); // HH:MM
    const bucket = this.timeBuckets.get(timeKey) ?? { published: 0, rejected: 0 };
    if (published) {
      bucket.published++;
    } else {
      bucket.rejected++;
    }
    this.timeBuckets.set(timeKey, bucket);

    if (this.timeBuckets.size > 60) {
      const oldestKey = this.timeBuckets.keys().next().value;
      if (oldestKey) this.timeBuckets.delete(oldestKey);
    }
  }

  /**
   * Returns complete real-time aggregated summary.
   */
  getSummary(): KafkaAnalyticsSummary {
    const totalProcessed = this.totalPublished + this.totalRejected;
    const overallAcceptanceRate =
      totalProcessed > 0 ? Number(((this.totalPublished / totalProcessed) * 100).toFixed(1)) : 0;
    const overallRejectionRate =
      totalProcessed > 0 ? Number(((this.totalRejected / totalProcessed) * 100).toFixed(1)) : 0;

    const channelsArray = Array.from(this.channelMap.values());

    // Top publishing channels (ordered by published count descending)
    const topPublishingChannels = channelsArray
      .filter((c) => c.publishedCount > 0)
      .sort((a, b) => b.publishedCount - a.publishedCount)
      .slice(0, 10)
      .map((c) => ({
        channel: c.channel,
        source: c.source,
        count: c.publishedCount,
        percentage:
          this.totalPublished > 0 ? Number(((c.publishedCount / this.totalPublished) * 100).toFixed(1)) : 0,
      }));

    // Top failing channels (channels that don't meet criteria most often)
    const topFailingChannels = channelsArray
      .filter((c) => c.rejectedCount > 0)
      .sort((a, b) => b.rejectedCount - a.rejectedCount || b.rejectionRate - a.rejectionRate)
      .slice(0, 10)
      .map((c) => ({
        channel: c.channel,
        source: c.source,
        rejectedCount: c.rejectedCount,
        totalFetched: c.totalFetched,
        failureRate: c.rejectionRate,
      }));

    // Distribution across all publishing channels
    const distribution = topPublishingChannels.map((c) => ({
      name: c.channel,
      value: c.count,
      percentage: c.percentage,
    }));

    // Time-series array sorted by time
    const timeSeries = Array.from(this.timeBuckets.entries()).map(([timestamp, counts]) => ({
      timestamp,
      published: counts.published,
      rejected: counts.rejected,
    }));

    return {
      totalPublished: this.totalPublished,
      totalRejected: this.totalRejected,
      totalProcessed,
      overallAcceptanceRate,
      overallRejectionRate,
      channels: Object.fromEntries(this.channelMap.entries()),
      topPublishingChannels,
      topFailingChannels,
      distribution,
      recentEvents: this.recentEventsList.slice(0, 100),
      timeSeries,
    };
  }

  /**
   * Subscribes to the live SSE stream of Kafka and filter events.
   */
  subscribe(listener: (event: KafkaStreamEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => {
      this.emitter.off('event', listener);
    };
  }

  /**
   * Simulates random incoming live post (either published or rejected) for testing or demoing.
   */
  simulateRandomEvent(): KafkaStreamEvent {
    const isPublish = Math.random() > 0.45;
    const channels = Array.from(this.channelMap.keys());
    const channel = channels[Math.floor(Math.random() * channels.length)] || 'mock_stream_channel';
    const source = this.channelMap.get(channel)?.source || (Math.random() > 0.5 ? 'telegram' : 'x');

    if (isPublish) {
      const sampleTexts = [
        'Breaking: Security alert sounded near central crossing, alerts activated.',
        'צבע אדום בעוטף עזה, זוהו שיגורים לעבר האזור',
        'عاجל: إطلاق صواريخ باتجاه مواقع عسكرية والمدفعية ترد',
        'Drone infiltration alarm activated across northern border district.',
        'עימותים אלימים דווחו בגזרה הדרומית, פיצוצים נשמעים במרחב',
      ];
      const text = sampleTexts[Math.floor(Math.random() * sampleTexts.length)];
      return this.recordPublished({
        id: randomUUID(),
        channel,
        source,
        content: text,
        reportId: Math.floor(Math.random() * 90000) + 10000,
        termsMatched: ['alert', 'rocket', 'שיגור', 'alarm'],
        language: 'mixed',
        timestamp: new Date().toISOString(),
      });
    } else {
      const sampleNonMatchingTexts = [
        'Local market prices for produce updated for the weekend.',
        'הפסקת מים זמנית ברחובות המרכזיים עקב עבודות תשתית בעירייה',
        'مباراة كرة القدم الليلة تنتهي بالتعادل الإيجابي بين الفريقين',
        'Tech conference announced for next month in Tel Aviv convention center.',
        'Good morning, traffic is moving slowly on Route 4 southwards.',
      ];
      const text = sampleNonMatchingTexts[Math.floor(Math.random() * sampleNonMatchingTexts.length)];
      return this.recordRejected({
        id: randomUUID(),
        channel,
        source,
        content: text,
        reason: 'No threat or violence keywords matched criteria',
        attemptedLanguages: ['ar', 'he', 'en', 'fa'],
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Resets all recorded analytics counters.
   */
  reset(): void {
    this.totalPublished = 0;
    this.totalRejected = 0;
    this.channelMap.clear();
    this.recentEventsList.length = 0;
    this.timeBuckets.clear();
    this.initializeBaselineData();
  }
}
