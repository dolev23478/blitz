'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  ConnectionStatus,
  KafkaAnalyticsSummary,
  KafkaStreamEvent,
} from '../types/analytics';

const BASELINE_FALLBACK: KafkaAnalyticsSummary = {
  totalPublished: 388,
  totalRejected: 205,
  totalProcessed: 593,
  overallAcceptanceRate: 65.4,
  overallRejectionRate: 34.6,
  channels: {
    osint_middle_east: {
      channel: 'osint_middle_east',
      source: 'x',
      publishedCount: 62,
      rejectedCount: 8,
      totalFetched: 70,
      acceptanceRate: 88.6,
      rejectionRate: 11.4,
      lastActive: new Date().toISOString(),
    },
    quds_news_network: {
      channel: 'quds_news_network',
      source: 'telegram',
      publishedCount: 58,
      rejectedCount: 31,
      totalFetched: 89,
      acceptanceRate: 65.2,
      rejectionRate: 34.8,
      lastActive: new Date().toISOString(),
    },
    jenin_brigade_media: {
      channel: 'jenin_brigade_media',
      source: 'telegram',
      publishedCount: 51,
      rejectedCount: 37,
      totalFetched: 88,
      acceptanceRate: 58.0,
      rejectionRate: 42.0,
      lastActive: new Date().toISOString(),
    },
    gaza_now_channel: {
      channel: 'gaza_now_channel',
      source: 'telegram',
      publishedCount: 48,
      rejectedCount: 12,
      totalFetched: 60,
      acceptanceRate: 80.0,
      rejectionRate: 20.0,
      lastActive: new Date().toISOString(),
    },
    war_monitor_x: {
      channel: 'war_monitor_x',
      source: 'x',
      publishedCount: 45,
      rejectedCount: 15,
      totalFetched: 60,
      acceptanceRate: 75.0,
      rejectionRate: 25.0,
      lastActive: new Date().toISOString(),
    },
    middle_east_observer: {
      channel: 'middle_east_observer',
      source: 'x',
      publishedCount: 41,
      rejectedCount: 26,
      totalFetched: 67,
      acceptanceRate: 61.2,
      rejectionRate: 38.8,
      lastActive: new Date().toISOString(),
    },
    lebanon_news_front: {
      channel: 'lebanon_news_front',
      source: 'telegram',
      publishedCount: 34,
      rejectedCount: 19,
      totalFetched: 53,
      acceptanceRate: 64.2,
      rejectionRate: 35.8,
      lastActive: new Date().toISOString(),
    },
    idf_spokesperson: {
      channel: 'idf_spokesperson',
      source: 'telegram',
      publishedCount: 29,
      rejectedCount: 4,
      totalFetched: 33,
      acceptanceRate: 87.9,
      rejectionRate: 12.1,
      lastActive: new Date().toISOString(),
    },
    syria_military_wire: {
      channel: 'syria_military_wire',
      source: 'telegram',
      publishedCount: 19,
      rejectedCount: 22,
      totalFetched: 41,
      acceptanceRate: 46.3,
      rejectionRate: 53.7,
      lastActive: new Date().toISOString(),
    },
    general_chatter_group: {
      channel: 'general_chatter_group',
      source: 'telegram',
      publishedCount: 3,
      rejectedCount: 48,
      totalFetched: 51,
      acceptanceRate: 5.9,
      rejectionRate: 94.1,
      lastActive: new Date().toISOString(),
    },
  },
  topPublishingChannels: [
    { channel: 'osint_middle_east', source: 'x', count: 62, percentage: 16.0 },
    { channel: 'quds_news_network', source: 'telegram', count: 58, percentage: 14.9 },
    { channel: 'jenin_brigade_media', source: 'telegram', count: 51, percentage: 13.1 },
    { channel: 'gaza_now_channel', source: 'telegram', count: 48, percentage: 12.4 },
    { channel: 'war_monitor_x', source: 'x', count: 45, percentage: 11.6 },
    { channel: 'middle_east_observer', source: 'x', count: 41, percentage: 10.6 },
    { channel: 'lebanon_news_front', source: 'telegram', count: 34, percentage: 8.8 },
    { channel: 'idf_spokesperson', source: 'telegram', count: 29, percentage: 7.5 },
  ],
  topFailingChannels: [
    { channel: 'general_chatter_group', source: 'telegram', rejectedCount: 48, totalFetched: 51, failureRate: 94.1 },
    { channel: 'jenin_brigade_media', source: 'telegram', rejectedCount: 37, totalFetched: 88, failureRate: 42.0 },
    { channel: 'quds_news_network', source: 'telegram', rejectedCount: 31, totalFetched: 89, failureRate: 34.8 },
    { channel: 'middle_east_observer', source: 'x', rejectedCount: 26, totalFetched: 67, failureRate: 38.8 },
    { channel: 'syria_military_wire', source: 'telegram', rejectedCount: 22, totalFetched: 41, failureRate: 53.7 },
    { channel: 'lebanon_news_front', source: 'telegram', rejectedCount: 19, totalFetched: 53, failureRate: 35.8 },
    { channel: 'war_monitor_x', source: 'x', rejectedCount: 15, totalFetched: 60, failureRate: 25.0 },
    { channel: 'gaza_now_channel', source: 'telegram', rejectedCount: 12, totalFetched: 60, failureRate: 20.0 },
  ],
  distribution: [
    { name: 'osint_middle_east', value: 62, percentage: 16.0 },
    { name: 'quds_news_network', value: 58, percentage: 14.9 },
    { name: 'jenin_brigade_media', value: 51, percentage: 13.1 },
    { name: 'gaza_now_channel', value: 48, percentage: 12.4 },
    { name: 'war_monitor_x', value: 45, percentage: 11.6 },
    { name: 'middle_east_observer', value: 41, percentage: 10.6 },
    { name: 'lebanon_news_front', value: 34, percentage: 8.8 },
    { name: 'idf_spokesperson', value: 29, percentage: 7.5 },
  ],
  recentEvents: [
    {
      type: 'kafka_published',
      id: 'init-1',
      channel: 'osint_middle_east',
      source: 'x',
      content: 'Rocket warning sirens sounded across the northern border region following artillery exchange.',
      reportId: 98124,
      termsMatched: ['rocket', 'sirens', 'artillery'],
      language: 'en',
      timestamp: new Date(Date.now() - 25000).toISOString(),
      topic: 'raw-reports',
    },
    {
      type: 'filter_rejected',
      id: 'init-2',
      channel: 'general_chatter_group',
      source: 'telegram',
      content: 'Weather forecast for this evening: partly cloudy with light breeze.',
      reason: 'No threat or violence keywords matched criteria',
      attemptedLanguages: ['ar', 'he', 'en', 'fa'],
      timestamp: new Date(Date.now() - 55000).toISOString(),
    },
    {
      type: 'kafka_published',
      id: 'init-3',
      channel: 'quds_news_network',
      source: 'telegram',
      content: 'דיווח ראשוני על פיצוץ מטען ליד המחסום, כוחות ביטחון הוזעקו לזירה',
      reportId: 98125,
      termsMatched: ['מטען', 'פיצוץ'],
      language: 'he',
      timestamp: new Date(Date.now() - 95000).toISOString(),
      topic: 'raw-reports',
    },
    {
      type: 'filter_rejected',
      id: 'init-4',
      channel: 'middle_east_observer',
      source: 'x',
      content: 'Oil prices edge lower on Asian morning trading sessions amidst market stabilization.',
      reason: 'No threat or violence keywords matched criteria',
      attemptedLanguages: ['en'],
      timestamp: new Date(Date.now() - 140000).toISOString(),
    },
  ],
  timeSeries: [
    { timestamp: '12:00', published: 6, rejected: 3 },
    { timestamp: '12:05', published: 9, rejected: 5 },
    { timestamp: '12:10', published: 4, rejected: 2 },
    { timestamp: '12:15', published: 11, rejected: 7 },
    { timestamp: '12:20', published: 8, rejected: 4 },
    { timestamp: '12:25', published: 14, rejected: 6 },
    { timestamp: '12:30', published: 10, rejected: 5 },
  ],
};

export function useAnalyticsStream() {
  const [data, setData] = useState<KafkaAnalyticsSummary>(BASELINE_FALLBACK);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);
  const [isAutoSimulating, setIsAutoSimulating] = useState(false);
  const autoSimTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Ingests a new single event into current summary state
  const ingestEvent = useCallback((event: KafkaStreamEvent) => {
    setData((prev) => {
      const isPublished = event.type === 'kafka_published';
      const newTotalPub = prev.totalPublished + (isPublished ? 1 : 0);
      const newTotalRej = prev.totalRejected + (isPublished ? 0 : 1);
      const newTotalProcessed = newTotalPub + newTotalRej;

      const chName = event.channel;
      const currentCh = prev.channels[chName] ?? {
        channel: chName,
        source: event.source || 'unknown',
        publishedCount: 0,
        rejectedCount: 0,
        totalFetched: 0,
        rejectionRate: 0,
        acceptanceRate: 0,
        lastActive: new Date().toISOString(),
      };

      const updatedCh = {
        ...currentCh,
        publishedCount: currentCh.publishedCount + (isPublished ? 1 : 0),
        rejectedCount: currentCh.rejectedCount + (isPublished ? 0 : 1),
        totalFetched: currentCh.totalFetched + 1,
        lastActive: new Date().toISOString(),
      };
      updatedCh.rejectionRate = Number(
        ((updatedCh.rejectedCount / updatedCh.totalFetched) * 100).toFixed(1),
      );
      updatedCh.acceptanceRate = Number(
        ((updatedCh.publishedCount / updatedCh.totalFetched) * 100).toFixed(1),
      );

      const newChannels = { ...prev.channels, [chName]: updatedCh };
      const allChannels = Object.values(newChannels);

      const topPublishingChannels = allChannels
        .filter((c) => c.publishedCount > 0)
        .sort((a, b) => b.publishedCount - a.publishedCount)
        .slice(0, 10)
        .map((c) => ({
          channel: c.channel,
          source: c.source,
          count: c.publishedCount,
          percentage: Number(((c.publishedCount / newTotalPub) * 100).toFixed(1)),
        }));

      const topFailingChannels = allChannels
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

      const distribution = topPublishingChannels.map((c) => ({
        name: c.channel,
        value: c.count,
        percentage: c.percentage,
      }));

      const recentEvents = [event, ...prev.recentEvents.slice(0, 99)];

      // Time series bucket update
      const timeKey = (event.timestamp || new Date().toISOString()).slice(11, 16);
      const existingBucketIndex = prev.timeSeries.findIndex((b) => b.timestamp === timeKey);
      let updatedTimeSeries = [...prev.timeSeries];
      if (existingBucketIndex >= 0) {
        const bucket = { ...updatedTimeSeries[existingBucketIndex]! };
        if (isPublished) bucket.published++;
        else bucket.rejected++;
        updatedTimeSeries[existingBucketIndex] = bucket;
      } else {
        updatedTimeSeries.push({
          timestamp: timeKey,
          published: isPublished ? 1 : 0,
          rejected: isPublished ? 0 : 1,
        });
        if (updatedTimeSeries.length > 20) {
          updatedTimeSeries.shift();
        }
      }

      return {
        totalPublished: newTotalPub,
        totalRejected: newTotalRej,
        totalProcessed: newTotalProcessed,
        overallAcceptanceRate: Number(((newTotalPub / newTotalProcessed) * 100).toFixed(1)),
        overallRejectionRate: Number(((newTotalRej / newTotalProcessed) * 100).toFixed(1)),
        channels: newChannels,
        topPublishingChannels,
        topFailingChannels,
        distribution,
        recentEvents,
        timeSeries: updatedTimeSeries,
      };
    });
  }, []);

  // Connect to SSE endpoint
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let retryTimeout: NodeJS.Timeout | null = null;

    const connect = () => {
      setStatus('connecting');
      const url = '/api/kafka/analytics/stream';

      try {
        eventSource = new EventSource(url);

        eventSource.onopen = () => {
          setStatus('connected');
          setLastHeartbeat(new Date().toLocaleTimeString());
        };

        eventSource.addEventListener('snapshot', (e) => {
          try {
            const snapshot = JSON.parse(e.data) as KafkaAnalyticsSummary;
            setData(snapshot);
            setStatus('connected');
          } catch (err) {
            console.error('Failed to parse snapshot:', err);
          }
        });

        eventSource.addEventListener('kafka_event', (e) => {
          try {
            const event = JSON.parse(e.data) as KafkaStreamEvent;
            ingestEvent(event);
            setLastHeartbeat(new Date().toLocaleTimeString());
          } catch (err) {
            console.error('Failed to parse kafka_event:', err);
          }
        });

        eventSource.addEventListener('ping', () => {
          setLastHeartbeat(new Date().toLocaleTimeString());
        });

        eventSource.onerror = () => {
          setStatus('disconnected');
          eventSource?.close();
          // Attempt reconnect after 4 seconds
          retryTimeout = setTimeout(() => {
            connect();
          }, 4000);
        };
      } catch {
        setStatus('error');
        retryTimeout = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      eventSource?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [ingestEvent]);

  // Client-side simulation fallback if backend isn't reached or when user clicks simulate
  const simulate = useCallback(
    async (count = 1) => {
      // First try calling backend simulate API
      try {
        const res = await fetch(`/api/kafka/analytics/simulate?count=${count}`, {
          method: 'POST',
        });
        if (res.ok) {
          const result = await res.json();
          // Events will arrive via SSE stream automatically!
          return;
        }
      } catch {
        // Fallback to local simulation
      }

      // Local synthetic generation fallback
      for (let i = 0; i < count; i++) {
        const isPublish = Math.random() > 0.4;
        const channelPool = Object.keys(data.channels);
        const channel = channelPool[Math.floor(Math.random() * channelPool.length)] || 'realtime_channel';
        const source = data.channels[channel]?.source || (Math.random() > 0.5 ? 'telegram' : 'x');

        if (isPublish) {
          const sampleTexts = [
            'Rocket sirens activated in border communities following multiple launches.',
            'פיצוץ עז נשמע סמוך לקו העימות, כוחות הביטחון עורכים סריקות במרחב',
            'عاجل: رشقة صاروخية مكثفة باتجاه المواقع الشمالية وصفارات الإنذار تدوي',
            'Drone infiltration alarm sounding in industrial sector near coastline.',
            'דיווח ראשוני: חילופי אש כבדים פרצו במהלך פעילות מבצעית במחנה הפליטים',
          ];
          const text = sampleTexts[Math.floor(Math.random() * sampleTexts.length)]!;
          ingestEvent({
            type: 'kafka_published',
            id: `sim-pub-${Date.now()}-${i}`,
            channel,
            source,
            content: text,
            reportId: Math.floor(Math.random() * 80000) + 10000,
            termsMatched: ['rocket', 'sirens', 'פיצוץ', 'צבע אדום'],
            language: 'mixed',
            timestamp: new Date().toISOString(),
            topic: 'raw-reports',
          });
        } else {
          const sampleRejections = [
            'Market opening hours extended for the holiday shopping season.',
            'עיריית תל אביב מודיעה על שיבושי תנועה זמניים עקב עבודות סלילה',
            'النشرة الجوية: طقس معتدل ودرجات حرارة حول معدلاتها السنوية',
            'Football league championship match postponed to next Tuesday.',
            'שירותי רכבת ישראל יפעלו במתכונת מתוגברת בסוף השבוע הקרוב',
          ];
          const text = sampleRejections[Math.floor(Math.random() * sampleRejections.length)]!;
          ingestEvent({
            type: 'filter_rejected',
            id: `sim-rej-${Date.now()}-${i}`,
            channel,
            source,
            content: text,
            reason: 'Keyword filter rejected: did not match any threat terms',
            attemptedLanguages: ['ar', 'he', 'en', 'fa'],
            timestamp: new Date().toISOString(),
          });
        }
      }
    },
    [data.channels, ingestEvent],
  );

  const reset = useCallback(async () => {
    try {
      await fetch('/api/kafka/analytics/reset', { method: 'POST' });
    } catch {
      // Local fallback
    }
    setData(BASELINE_FALLBACK);
  }, []);

  const toggleAutoSimulate = useCallback(() => {
    setIsAutoSimulating((prev) => !prev);
  }, []);

  useEffect(() => {
    if (isAutoSimulating) {
      autoSimTimerRef.current = setInterval(() => {
        void simulate(1);
      }, 2500);
    } else {
      if (autoSimTimerRef.current) clearInterval(autoSimTimerRef.current);
    }
    return () => {
      if (autoSimTimerRef.current) clearInterval(autoSimTimerRef.current);
    };
  }, [isAutoSimulating, simulate]);

  return {
    data,
    status,
    lastHeartbeat,
    simulate,
    reset,
    isAutoSimulating,
    toggleAutoSimulate,
  };
}
