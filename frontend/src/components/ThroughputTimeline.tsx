'use client';

import React from 'react';
import { TrendingUp, BarChart3 } from 'lucide-react';
import type { KafkaAnalyticsSummary } from '../types/analytics';

interface ThroughputTimelineProps {
  data: KafkaAnalyticsSummary;
}

export const ThroughputTimeline: React.FC<ThroughputTimelineProps> = ({ data }) => {
  const points = data.timeSeries.slice(-14);
  const maxVal = Math.max(
    ...points.map((p) => p.published + p.rejected),
    10,
  );

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="flex items-center space-x-2 text-sm font-bold text-white">
            <BarChart3 className="h-4 w-4 text-teal-400" />
            <span>Ingress Telemetry Timeline</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Real-time throughput: Kafka published posts vs. keyword filter rejections
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center space-x-3 text-xs">
          <div className="flex items-center space-x-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
            <span className="text-slate-300">Published to Kafka</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
            <span className="text-slate-300">Disqualified</span>
          </div>
        </div>
      </div>

      {/* Bar Chart Visualization */}
      <div className="mt-6 flex flex-1 items-end justify-between gap-2 pt-4">
        {points.map((p, idx) => {
          const pubHeight = Math.max(Math.round((p.published / maxVal) * 120), 4);
          const rejHeight = Math.max(Math.round((p.rejected / maxVal) * 120), 4);

          return (
            <div
              key={idx}
              className="group flex flex-1 flex-col items-center justify-end"
            >
              {/* Tooltip on hover */}
              <div className="pointer-events-none mb-1 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200 shadow-lg whitespace-nowrap">
                  <span className="font-bold text-emerald-400">{p.published}</span> pub /{' '}
                  <span className="font-bold text-rose-400">{p.rejected}</span> rej
                </div>
              </div>

              {/* Stacked or side-by-side bars */}
              <div className="flex w-full items-end justify-center space-x-1">
                {/* Published bar */}
                <div
                  className="w-1/2 max-w-[14px] rounded-t bg-gradient-to-t from-emerald-600 to-teal-400 transition-all duration-500 group-hover:brightness-125"
                  style={{ height: `${pubHeight}px` }}
                />
                {/* Rejected bar */}
                <div
                  className="w-1/2 max-w-[14px] rounded-t bg-gradient-to-t from-rose-600 to-amber-500 transition-all duration-500 group-hover:brightness-125"
                  style={{ height: `${rejHeight}px` }}
                />
              </div>

              {/* Time Label */}
              <span className="mt-2 text-[10px] text-slate-500 font-mono">
                {p.timestamp}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
