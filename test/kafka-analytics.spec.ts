import { describe, expect, it } from 'vitest';
import { KafkaAnalyticsService } from '../src/analytics/kafka-analytics.service.js';
import type { KafkaStreamEvent } from '../src/analytics/kafka-analytics.types.js';

describe('KafkaAnalyticsService', () => {
  it('should initialize baseline statistics correctly', () => {
    const service = new KafkaAnalyticsService();
    const summary = service.getSummary();

    expect(summary.totalPublished).toBeGreaterThan(0);
    expect(summary.totalRejected).toBeGreaterThan(0);
    expect(summary.totalProcessed).toBe(summary.totalPublished + summary.totalRejected);
    expect(summary.topPublishingChannels.length).toBeGreaterThan(0);
    expect(summary.topFailingChannels.length).toBeGreaterThan(0);
    expect(summary.distribution.length).toBeGreaterThan(0);
  });

  it('should record published Kafka events and update metrics', () => {
    const service = new KafkaAnalyticsService();
    const before = service.getSummary();

    const publishedEvent = service.recordPublished({
      id: 'test-event-1',
      channel: 'new_breaking_channel',
      source: 'telegram',
      content: 'Major security incident reported with rocket sirens',
      reportId: 55555,
      termsMatched: ['rocket', 'incident'],
      language: 'en',
      timestamp: new Date().toISOString(),
      topic: 'raw-reports',
    });

    const after = service.getSummary();
    expect(after.totalPublished).toBe(before.totalPublished + 1);
    expect(after.totalProcessed).toBe(before.totalProcessed + 1);
    expect(after.channels['new_breaking_channel']).toBeDefined();
    expect(after.channels['new_breaking_channel']?.publishedCount).toBe(1);
    expect(after.recentEvents[0]?.id).toBe('test-event-1');
  });

  it('should record keyword filter rejection events and track failing channels', () => {
    const service = new KafkaAnalyticsService();
    const before = service.getSummary();

    const rejectedEvent = service.recordRejected({
      id: 'test-reject-1',
      channel: 'chatty_weather_channel',
      source: 'telegram',
      content: 'Sunny afternoon in the park with nice breeze',
      reason: 'No threat keywords matched criteria',
      attemptedLanguages: ['ar', 'he', 'en', 'fa'],
      timestamp: new Date().toISOString(),
    });

    const after = service.getSummary();
    expect(after.totalRejected).toBe(before.totalRejected + 1);
    expect(after.channels['chatty_weather_channel']?.rejectedCount).toBe(1);
    expect(after.recentEvents[0]?.id).toBe('test-reject-1');

    const topFailing = after.topFailingChannels.find((c) => c.channel === 'chatty_weather_channel');
    expect(topFailing).toBeDefined();
    expect(topFailing?.rejectedCount).toBe(1);
  });

  it('should notify SSE subscribers on events', () => {
    const service = new KafkaAnalyticsService();
    const received: KafkaStreamEvent[] = [];

    const unsubscribe = service.subscribe((event) => {
      received.push(event);
    });

    service.recordPublished({
      id: 'sub-pub-1',
      channel: 'intel_wire',
      source: 'x',
      content: 'Explosion alert',
      timestamp: new Date().toISOString(),
    });

    service.recordRejected({
      id: 'sub-rej-1',
      channel: 'sports_news',
      source: 'x',
      content: 'Goal scored in stoppage time',
      reason: 'No threat keywords',
      timestamp: new Date().toISOString(),
    });

    expect(received.length).toBe(2);
    expect(received[0]?.type).toBe('kafka_published');
    expect(received[1]?.type).toBe('filter_rejected');

    unsubscribe();

    service.recordPublished({
      id: 'sub-pub-2',
      channel: 'intel_wire',
      source: 'x',
      content: 'Another alert',
      timestamp: new Date().toISOString(),
    });

    expect(received.length).toBe(2); // no more events after unsubscribe
  });

  it('should simulate events cleanly', () => {
    const service = new KafkaAnalyticsService();
    const simulated = service.simulateRandomEvent();
    expect(simulated).toBeDefined();
    expect(['kafka_published', 'filter_rejected']).toContain(simulated.type);
  });
});
