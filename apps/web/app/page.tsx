'use client';

import React, { useEffect, useState } from 'react';
import {
  buildDemoAnalyticsSummary,
  type FilteredPost,
  type KafkaAnalyticsSummary,
  type KafkaStreamEvent,
} from '@blitz/shared';
import { Header, type ActiveTab } from './components/Header';
import { KpiCards } from './components/KpiCards';
import { ChannelDistributionChart } from './components/ChannelDistributionChart';
import { FilterFailureChart } from './components/FilterFailureChart';
import { LiveTelemetryStream } from './components/LiveTelemetryStream';
import { FilteredPostsFeed } from './components/FilteredPostsFeed';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const initialThreatPosts: FilteredPost[] = [
  {
    id: 'demo-1',
    source: 'telegram',
    channel: 't.me/military_intel_tg',
    text: 'We are preparing explosives near the station and will strike before sunrise.',
    createdAt: new Date(Date.now() - 120000).toISOString(),
    severity: 'high',
    matches: [
      { term: 'explosives', normalized: 'explosives', start: 19, end: 29, category: 'weapon' },
      { term: 'strike', normalized: 'strike', start: 57, end: 63, category: 'violence' },
      { term: 'sunrise', normalized: 'sunrise', start: 75, end: 82, category: 'threat' },
    ],
  },
  {
    id: 'demo-2',
    source: 'x',
    channel: '@idf_spokesperson',
    text: 'The team is moving a drone toward the military checkpoint.',
    createdAt: new Date(Date.now() - 300000).toISOString(),
    severity: 'medium',
    matches: [
      { term: 'drone', normalized: 'drone', start: 19, end: 24, category: 'weapon' },
      { term: 'military', normalized: 'military', start: 41, end: 49, category: 'threat' },
    ],
  },
];

export default function Page() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('analytics');
  const [summary, setSummary] = useState<KafkaAnalyticsSummary>(buildDemoAnalyticsSummary);
  const [threatPosts, setThreatPosts] = useState<FilteredPost[]>(initialThreatPosts);
  const [connected, setConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Initial Fetch & SSE streams
  useEffect(() => {
    // 1. Initial snapshot fetch for analytics
    const loadSnapshot = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/analytics/snapshot`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as KafkaAnalyticsSummary;
          if (data && typeof data.totalPublished === 'number') {
            setSummary(data);
          }
        }
      } catch {
        // Backend might still be starting up; fallback remains active
      }
    };

    // 2. Initial fetch for filtered posts
    const loadPosts = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/posts`, { cache: 'no-store' });
        if (res.ok) {
          const items = (await res.json()) as FilteredPost[];
          if (Array.isArray(items) && items.length) {
            setThreatPosts(items.slice(0, 50));
          }
        }
      } catch {
        // Backend not ready yet
      }
    };

    void loadSnapshot();
    void loadPosts();

    // 3. Connect to Analytics SSE Stream
    const analyticsSource = new EventSource(`${API_BASE}/api/analytics/stream`);

    analyticsSource.onopen = () => setConnected(true);
    analyticsSource.onerror = () => setConnected(false);

    analyticsSource.onmessage = (event: MessageEvent<string>) => {
      if (isPaused) return;
      try {
        const payload = JSON.parse(event.data) as {
          type?: string;
          payload?: any;
          summary?: KafkaAnalyticsSummary;
        };

        if (payload.type === 'snapshot' && payload.payload) {
          setSummary(payload.payload as KafkaAnalyticsSummary);
        } else if (payload.summary) {
          setSummary(payload.summary);
        }
      } catch {
        // Ignore unparseable frames
      }
    };

    // 4. Connect to Filtered Posts SSE Stream
    const postsSource = new EventSource(`${API_BASE}/api/posts/stream`);

    postsSource.addEventListener('filtered-post', (event: MessageEvent<string>) => {
      if (isPaused) return;
      try {
        const payload = JSON.parse(event.data) as { payload?: FilteredPost };
        const post = payload.payload ?? (payload as unknown as FilteredPost);
        if (post && post.text) {
          setThreatPosts((current) => [post, ...current].slice(0, 50));
        }
      } catch {
        // Ignore malformed frames
      }
    });

    return () => {
      analyticsSource.close();
      postsSource.close();
    };
  }, [isPaused]);

  const handleRefresh = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/analytics/snapshot`);
      if (res.ok) {
        const data = (await res.json()) as KafkaAnalyticsSummary;
        setSummary(data);
      }
    } catch {
      // Ignore
    }
  };

  return (
    <main className="dashboard-container">
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        connected={connected}
        isPaused={isPaused}
        onTogglePause={() => setIsPaused(!isPaused)}
        onRefresh={handleRefresh}
        totalPublished={summary.totalPublished}
        totalRejected={summary.totalRejected}
        threatPostsCount={threatPosts.length}
      />

      {/* TAB 1: KAFKA ANALYTICS & TELEMETRY */}
      {activeTab === 'analytics' && (
        <div className="tab-pane">
          <KpiCards summary={summary} />

          <div className="charts-split-grid">
            <ChannelDistributionChart
              distribution={summary.distribution}
              totalPublished={summary.totalPublished}
            />
            <FilterFailureChart
              topFailingChannels={summary.topFailingChannels}
              totalRejected={summary.totalRejected}
            />
          </div>

          <LiveTelemetryStream events={summary.recentEvents} />
        </div>
      )}

      {/* TAB 2: FILTERED THREAT POSTS FEED */}
      {activeTab === 'threats' && (
        <div className="tab-pane">
          <FilteredPostsFeed posts={threatPosts} />
        </div>
      )}

      {/* TAB 3: UNIFIED INTELLIGENCE VIEW */}
      {activeTab === 'unified' && (
        <div className="tab-pane">
          <KpiCards summary={summary} />

          <div className="unified-layout-grid">
            <div className="unified-left-col">
              <ChannelDistributionChart
                distribution={summary.distribution}
                totalPublished={summary.totalPublished}
              />
              <FilterFailureChart
                topFailingChannels={summary.topFailingChannels}
                totalRejected={summary.totalRejected}
              />
            </div>

            <div className="unified-right-col">
              <FilteredPostsFeed posts={threatPosts} />
            </div>
          </div>

          <LiveTelemetryStream events={summary.recentEvents} />
        </div>
      )}
    </main>
  );
}
