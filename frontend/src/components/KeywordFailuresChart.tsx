'use client';

import React from 'react';
import { AlertTriangle, Filter, Flame } from 'lucide-react';
import type { KafkaAnalyticsSummary } from '../types/analytics';

interface KeywordFailuresChartProps {
  data: KafkaAnalyticsSummary;
}

export const KeywordFailuresChart: React.FC<KeywordFailuresChartProps> = ({ data }) => {
  const topFailing = data.topFailingChannels.slice(0, 8);
  const maxRejected = topFailing.length > 0 ? topFailing[0]!.rejectedCount : 1;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="flex items-center space-x-2 text-sm font-bold text-white">
            <Filter className="h-4 w-4 text-rose-400" />
            <span>Keyword Filter Failure Leaderboard</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Channels that don&apos;t meet threat criteria most often (disqualified from Kafka)
          </p>
        </div>
        <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-400">
          {data.totalRejected.toLocaleString()} Rejections
        </span>
      </div>

      <div className="mt-4 flex-1 space-y-3.5">
        {topFailing.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-slate-500">
            No filter rejections recorded yet.
          </div>
        ) : (
          topFailing.map((item, idx) => {
            const barWidth = Math.max(Math.round((item.rejectedCount / maxRejected) * 100), 4);
            const highFailure = item.failureRate > 60;

            return (
              <div
                key={item.channel}
                className="group relative rounded-xl border border-transparent p-2 transition-all hover:border-slate-800 hover:bg-slate-800/40"
              >
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-slate-400">
                      #{idx + 1}
                    </span>

                    <span className="font-semibold text-slate-200 transition-colors group-hover:text-rose-400">
                      {item.channel}
                    </span>

                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-medium uppercase tracking-wider ${
                        item.source === 'telegram'
                          ? 'bg-sky-500/15 text-sky-400'
                          : 'bg-neutral-800 text-neutral-300'
                      }`}
                    >
                      {item.source}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-bold text-rose-300">
                      {item.rejectedCount.toLocaleString()} rejected
                    </span>
                    <span
                      className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold ${
                        highFailure
                          ? 'border border-rose-500/30 bg-rose-500/20 text-rose-300'
                          : 'bg-amber-500/10 text-amber-400'
                      }`}
                    >
                      {item.failureRate}% fail rate
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800/80">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      highFailure
                        ? 'bg-gradient-to-r from-rose-500 via-rose-400 to-amber-400 shadow-sm shadow-rose-500/30'
                        : 'bg-gradient-to-r from-amber-500 to-rose-400'
                    }`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
