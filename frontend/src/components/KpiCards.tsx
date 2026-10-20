'use client';

import React from 'react';
import {
  CheckCircle2,
  XCircle,
  Layers,
  Percent,
  TrendingUp,
  Radio,
  ShieldCheck,
  Filter,
} from 'lucide-react';
import type { KafkaAnalyticsSummary } from '../types/analytics';

interface KpiCardsProps {
  data: KafkaAnalyticsSummary;
}

export const KpiCards: React.FC<KpiCardsProps> = ({ data }) => {
  const activeChannelsCount = Object.keys(data.channels).length;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1. Streamed to Kafka */}
      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-slate-900/60 p-5 shadow-lg backdrop-blur-md transition-all hover:border-emerald-500/40 hover:shadow-emerald-500/5">
        <div className="absolute right-0 top-0 -mr-6 -mt-6 h-24 w-24 rounded-full bg-emerald-500/10 blur-xl" />
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Streamed to Kafka
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline space-x-2">
          <span className="text-3xl font-extrabold tracking-tight text-white">
            {data.totalPublished.toLocaleString()}
          </span>
          <span className="text-xs font-medium text-emerald-400">
            ({data.overallAcceptanceRate}% pass rate)
          </span>
        </div>

        <p className="mt-2 text-xs text-slate-400">
          Successfully verified & queued into Kafka <code className="text-emerald-300">raw-reports</code>
        </p>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
            style={{ width: `${Math.min(data.overallAcceptanceRate, 100)}%` }}
          />
        </div>
      </div>

      {/* 2. Failed Keyword Filter */}
      <div className="relative overflow-hidden rounded-2xl border border-rose-500/20 bg-slate-900/60 p-5 shadow-lg backdrop-blur-md transition-all hover:border-rose-500/40 hover:shadow-rose-500/5">
        <div className="absolute right-0 top-0 -mr-6 -mt-6 h-24 w-24 rounded-full bg-rose-500/10 blur-xl" />
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-rose-400">
            Keyword Filter Rejections
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400">
            <XCircle className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline space-x-2">
          <span className="text-3xl font-extrabold tracking-tight text-white">
            {data.totalRejected.toLocaleString()}
          </span>
          <span className="text-xs font-medium text-rose-400">
            ({data.overallRejectionRate}% rejected)
          </span>
        </div>

        <p className="mt-2 text-xs text-slate-400">
          Disqualified by multilingual threat lexicon gate
        </p>

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-500 transition-all duration-500"
            style={{ width: `${Math.min(data.overallRejectionRate, 100)}%` }}
          />
        </div>
      </div>

      {/* 3. Total Ingested Posts */}
      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-slate-900/60 p-5 shadow-lg backdrop-blur-md transition-all hover:border-cyan-500/40 hover:shadow-cyan-500/5">
        <div className="absolute right-0 top-0 -mr-6 -mt-6 h-24 w-24 rounded-full bg-cyan-500/10 blur-xl" />
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
            Total Evaluated Posts
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
            <Layers className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline space-x-2">
          <span className="text-3xl font-extrabold tracking-tight text-white">
            {data.totalProcessed.toLocaleString()}
          </span>
          <span className="text-xs font-medium text-slate-400">total ingress</span>
        </div>

        <p className="mt-2 text-xs text-slate-400">
          Fetched from Telegram MTProto & X OSINT scraper feeds
        </p>

        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
          <span>Active Monitored Sources:</span>
          <span className="font-semibold text-cyan-300">{activeChannelsCount} channels/handles</span>
        </div>
      </div>

      {/* 4. Stream Quality / Precision */}
      <div className="relative overflow-hidden rounded-2xl border border-indigo-500/20 bg-slate-900/60 p-5 shadow-lg backdrop-blur-md transition-all hover:border-indigo-500/40 hover:shadow-indigo-500/5">
        <div className="absolute right-0 top-0 -mr-6 -mt-6 h-24 w-24 rounded-full bg-indigo-500/10 blur-xl" />
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
            Filter Efficiency & Precision
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-400">
            <ShieldCheck className="h-4 w-4" />
          </div>
        </div>

        <div className="mt-3 flex items-baseline space-x-2">
          <span className="text-3xl font-extrabold tracking-tight text-indigo-300">
            {(data.overallAcceptanceRate > 0 ? (100 / (100 - data.overallRejectionRate + 1)).toFixed(2) : '1.00')}x
          </span>
          <span className="text-xs font-medium text-slate-400">noise reduction</span>
        </div>

        <p className="mt-2 text-xs text-slate-400">
          Noise-to-threat ratio filtered prior to Kafka publishing
        </p>

        <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
          <span>Dictionary coverage:</span>
          <span className="font-semibold text-emerald-400">HE, AR, FA, EN, EMOJI</span>
        </div>
      </div>
    </div>
  );
};
