'use client';

import React from 'react';
import { Send, Award, ExternalLink, CheckCircle } from 'lucide-react';
import type { KafkaAnalyticsSummary } from '../types/analytics';

interface TopPublishersChartProps {
  data: KafkaAnalyticsSummary;
}

export const TopPublishersChart: React.FC<TopPublishersChartProps> = ({ data }) => {
  const topList = data.topPublishingChannels.slice(0, 8);
  const maxCount = topList.length > 0 ? topList[0]!.count : 1;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="flex items-center space-x-2 text-sm font-bold text-white">
            <CheckCircle className="h-4 w-4 text-emerald-400" />
            <span>Top Publishing Channels to Kafka</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Channels producing the highest volume of verified posts emitted to queue
          </p>
        </div>
        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
          {data.totalPublished.toLocaleString()} Total Emitted
        </span>
      </div>

      <div className="mt-4 flex-1 space-y-3.5">
        {topList.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-slate-500">
            No published posts recorded yet.
          </div>
        ) : (
          topList.map((item, idx) => {
            const barWidth = Math.max(Math.round((item.count / maxCount) * 100), 4);
            const isTop3 = idx < 3;

            return (
              <div
                key={item.channel}
                className="group relative rounded-xl border border-transparent p-2 transition-all hover:border-slate-800 hover:bg-slate-800/40"
              >
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                        idx === 0
                          ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-400/40'
                          : idx === 1
                          ? 'bg-slate-300/20 text-slate-300 ring-1 ring-slate-300/40'
                          : idx === 2
                          ? 'bg-amber-700/20 text-amber-600 ring-1 ring-amber-600/40'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {idx + 1}
                    </span>

                    <span className="font-semibold text-slate-200 transition-colors group-hover:text-emerald-400">
                      {item.channel}
                    </span>

                    <span
                      className={`rounded px-1.5 py-0.2 text-[10px] font-medium uppercase tracking-wider ${
                        item.source === 'telegram'
                          ? 'bg-sky-500/15 text-sky-400'
                          : item.source === 'x'
                          ? 'bg-neutral-800 text-neutral-300'
                          : 'bg-emerald-500/15 text-emerald-400'
                      }`}
                    >
                      {item.source}
                    </span>
                  </div>

                  <div className="flex items-center space-x-2.5">
                    <span className="font-mono text-xs font-bold text-white">
                      {item.count.toLocaleString()} posts
                    </span>
                    <span className="font-mono text-[11px] text-emerald-400">
                      {item.percentage}%
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800/80">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      isTop3
                        ? 'bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-300 shadow-sm shadow-emerald-500/30'
                        : 'bg-gradient-to-r from-emerald-600 to-teal-500'
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
