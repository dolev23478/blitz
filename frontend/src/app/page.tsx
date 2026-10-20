'use client';

import React from 'react';
import { useAnalyticsStream } from '../lib/useAnalyticsStream';
import { Navbar } from '../components/Navbar';
import { KpiCards } from '../components/KpiCards';
import { TopPublishersChart } from '../components/TopPublishersChart';
import { KeywordFailuresChart } from '../components/KeywordFailuresChart';
import { ChannelDistributionChart } from '../components/ChannelDistributionChart';
import { ThroughputTimeline } from '../components/ThroughputTimeline';
import { LiveEventStream } from '../components/LiveEventStream';
import { Cpu, Database, Radio, ShieldAlert } from 'lucide-react';

export default function DashboardPage() {
  const {
    data,
    status,
    lastHeartbeat,
    simulate,
    reset,
    isAutoSimulating,
    toggleAutoSimulate,
  } = useAnalyticsStream();

  return (
    <div className="flex min-h-screen flex-col bg-[#090d16] text-slate-100">
      {/* Top Sticky Navigation */}
      <Navbar
        status={status}
        lastHeartbeat={lastHeartbeat}
        onSimulate={simulate}
        onReset={reset}
        isAutoSimulating={isAutoSimulating}
        onToggleAutoSimulate={toggleAutoSimulate}
      />

      {/* Main Content Dashboard */}
      <main className="mx-auto flex-1 w-full max-w-7xl px-4 py-6 sm:px-6 space-y-6">
        {/* Banner with Architecture Context */}
        <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-800/80 bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-950/90 p-4 shadow-md backdrop-blur sm:flex-row sm:items-center">
          <div className="flex items-center space-x-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-teal-500/30 bg-teal-500/10 text-teal-400">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-white text-sm">
                  Kafka Pipeline: <span className="font-mono text-emerald-400">raw-reports</span>
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 font-mono">
                  SSE /api/kafka/analytics/stream
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Monitors posts passing multilingual violence &amp; threat keyword dictionaries before queuing into Kafka.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-4 text-xs text-slate-400">
            <div className="flex items-center space-x-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span>Kafka Producer: <strong>Active</strong></span>
            </div>
            <div className="flex items-center space-x-1.5">
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              <span>Lexicons: <strong>Multi-lingual</strong></span>
            </div>
          </div>
        </div>

        {/* 1. Summary KPI Cards */}
        <KpiCards data={data} />

        {/* 2. Top Publishers & Filter Failure Leaderboards (Requirements 1 & 2) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Requirement 1: Which channels published the most posts to Kafka */}
          <TopPublishersChart data={data} />

          {/* Requirement 2: Which channels fail keyword criteria most often */}
          <KeywordFailuresChart data={data} />
        </div>

        {/* 3. Output Distribution & Throughput Timeline (Requirement 3 & Trends) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Requirement 3: Distribution of which channels emit the most posts */}
          <ChannelDistributionChart data={data} />

          {/* Telemetry Timeline */}
          <ThroughputTimeline data={data} />
        </div>

        {/* 4. Live Event Stream Feed (Requirement 2: Every time a post fails/publishes) */}
        <div className="w-full">
          <LiveEventStream events={data.recentEvents} />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-4 text-center text-xs text-slate-500">
        Blitz Kafka Stream Telemetry &bull; Real-time Server-Sent Events (SSE) Engine
      </footer>
    </div>
  );
}
