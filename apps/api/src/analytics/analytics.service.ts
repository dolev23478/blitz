import { Injectable } from '@nestjs/common';
import {
  buildDemoAnalyticsSummary,
  type ChannelAnalytics,
  type FilterRejectedEvent,
  type KafkaAnalyticsSummary,
  type KafkaPublishedEvent,
  type KafkaStreamEvent,
} from '@blitz/shared';

@Injectable()
export class AnalyticsService {
  private summary: KafkaAnalyticsSummary;
  private readonly listeners = new Set<(event: any) => void>();

  constructor() {
    this.summary = buildDemoAnalyticsSummary();
  }

  subscribe(listener: (event: any) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: any): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  getSnapshot(): KafkaAnalyticsSummary {
    return JSON.parse(JSON.stringify(this.summary));
  }

  reset(): void {
    this.summary = {
      totalPublished: 0,
      totalRejected: 0,
      totalProcessed: 0,
      overallAcceptanceRate: 0,
      overallRejectionRate: 0,
      channels: {},
      topPublishingChannels: [],
      topFailingChannels: [],
      distribution: [],
      recentEvents: [],
      timeSeries: [],
    };
    this.emit({ type: 'reset', summary: this.getSnapshot() });
  }

  recordPublished(event: Omit<KafkaPublishedEvent, 'type'>): void {
    const fullEvent: KafkaPublishedEvent = {
      ...event,
      type: 'kafka_published',
    };

    this.summary.totalPublished++;
    this.summary.totalProcessed++;
    this.updateChannel(event.channel, event.source, true);
    this.addRecentEvent(fullEvent);
    this.recalculateSummary();

    this.emit({ type: 'kafka_published', payload: fullEvent, summary: this.getSnapshot() });
  }

  recordRejected(event: Omit<FilterRejectedEvent, 'type'>): void {
    const fullEvent: FilterRejectedEvent = {
      ...event,
      type: 'filter_rejected',
    };

    this.summary.totalRejected++;
    this.summary.totalProcessed++;
    this.updateChannel(event.channel, event.source, false);
    this.addRecentEvent(fullEvent);
    this.recalculateSummary();

    this.emit({ type: 'filter_rejected', payload: fullEvent, summary: this.getSnapshot() });
  }

  private updateChannel(channelName: string, source: string, passed: boolean): void {
    if (!this.summary.channels[channelName]) {
      this.summary.channels[channelName] = {
        channel: channelName,
        source: source || 'unknown',
        publishedCount: 0,
        rejectedCount: 0,
        totalFetched: 0,
        rejectionRate: 0,
        acceptanceRate: 0,
        lastActive: new Date().toISOString(),
      };
    }

    const chan = this.summary.channels[channelName];
    chan.lastActive = new Date().toISOString();
    chan.totalFetched++;
    if (passed) {
      chan.publishedCount++;
    } else {
      chan.rejectedCount++;
    }

    chan.rejectionRate = Math.round((chan.rejectedCount / chan.totalFetched) * 1000) / 10;
    chan.acceptanceRate = Math.round((chan.publishedCount / chan.totalFetched) * 1000) / 10;
  }

  private addRecentEvent(event: KafkaStreamEvent): void {
    this.summary.recentEvents.unshift(event);
    if (this.summary.recentEvents.length > 200) {
      this.summary.recentEvents.length = 200;
    }
  }

  private recalculateSummary(): void {
    const total = this.summary.totalProcessed;
    if (total > 0) {
      this.summary.overallAcceptanceRate =
        Math.round((this.summary.totalPublished / total) * 1000) / 10;
      this.summary.overallRejectionRate =
        Math.round((this.summary.totalRejected / total) * 1000) / 10;
    }

    const channelList: ChannelAnalytics[] = Object.values(this.summary.channels);

    // 1. Top publishing channels
    const publishedList = channelList.filter((c: ChannelAnalytics) => c.publishedCount > 0);
    const totalPub = this.summary.totalPublished || 1;
    this.summary.topPublishingChannels = publishedList
      .sort((a: ChannelAnalytics, b: ChannelAnalytics) => b.publishedCount - a.publishedCount)
      .slice(0, 10)
      .map((c: ChannelAnalytics) => ({
        channel: c.channel,
        source: c.source,
        count: c.publishedCount,
        percentage: Math.round((c.publishedCount / totalPub) * 1000) / 10,
      }));

    // 2. Distribution of channel emissions
    this.summary.distribution = this.summary.topPublishingChannels.map((c) => ({
      name: c.channel,
      value: c.count,
      percentage: c.percentage,
    }));

    // 3. Channels that fail criteria most often
    const rejectedList = channelList.filter((c: ChannelAnalytics) => c.rejectedCount > 0);
    this.summary.topFailingChannels = rejectedList
      .sort(
        (a: ChannelAnalytics, b: ChannelAnalytics) =>
          b.rejectedCount - a.rejectedCount || b.rejectionRate - a.rejectionRate,
      )
      .slice(0, 10)
      .map((c: ChannelAnalytics) => ({
        channel: c.channel,
        source: c.source,
        rejectedCount: c.rejectedCount,
        totalFetched: c.totalFetched,
        failureRate: c.rejectionRate,
      }));
  }

  createDemoTelemetryEvent(): KafkaStreamEvent {
    const isPublished = Math.random() > 0.35;
    const sources = [
      't.me/military_intel_tg',
      '@idf_spokesperson',
      't.me/conflict_watch',
      't.me/general_news_hub',
    ];
    const chosenChannel = sources[Math.floor(Math.random() * sources.length)];
    const sourcePlatform = chosenChannel.startsWith('@') ? 'x' : 'telegram';
    const now = new Date().toISOString();

    if (isPublished) {
      const pubEvent: KafkaPublishedEvent = {
        type: 'kafka_published',
        id: `demo-pub-${Date.now()}`,
        channel: chosenChannel,
        source: sourcePlatform,
        content: 'Tactical alert: air patrol confirms interception over northern sector.',
        reportId: `rep-${Math.floor(Math.random() * 9000 + 1000)}`,
        termsMatched: ['air patrol', 'interception'],
        language: 'en',
        timestamp: now,
        topic: 'threat-intel-stream',
      };
      this.recordPublished(pubEvent);
      return pubEvent;
    } else {
      const rejEvent: FilterRejectedEvent = {
        type: 'filter_rejected',
        id: `demo-rej-${Date.now()}`,
        channel: chosenChannel,
        source: sourcePlatform,
        content: 'Routine sports report: match concluded with tie in regional stadium.',
        reason: 'Failed threat keyword filter (no qualifying security terms)',
        attemptedLanguages: ['en'],
        timestamp: now,
      };
      this.recordRejected(rejEvent);
      return rejEvent;
    }
  }
}
