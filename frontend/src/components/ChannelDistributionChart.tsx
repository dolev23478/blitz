'use client';

import React, { useState } from 'react';
import { PieChart, Share2 } from 'lucide-react';
import type { KafkaAnalyticsSummary } from '../types/analytics';

interface ChannelDistributionChartProps {
  data: KafkaAnalyticsSummary;
}

const PALETTE = [
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#ec4899', // pink
  '#14b8a6', // teal
  '#6366f1', // indigo
];

export const ChannelDistributionChart: React.FC<ChannelDistributionChartProps> = ({ data }) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const distribution = data.distribution.slice(0, 8);
  const totalValue = distribution.reduce((acc, curr) => acc + curr.value, 0) || 1;

  // Donut chart geometry calculations
  const size = 180;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulatedPercent = 0;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
        <div>
          <h2 className="flex items-center space-x-2 text-sm font-bold text-white">
            <PieChart className="h-4 w-4 text-cyan-400" />
            <span>Channel Output Distribution</span>
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Proportional share of verified posts streamed into Kafka per channel
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col items-center justify-around gap-6 sm:flex-row">
        {/* SVG Donut Chart */}
        <div className="relative flex items-center justify-center">
          <svg width={size} height={size} className="-rotate-90 transform">
            {/* Background ring */}
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke="#1e293b"
              strokeWidth={strokeWidth}
            />

            {/* Slices */}
            {distribution.map((item, idx) => {
              const slicePercent = item.value / totalValue;
              const strokeDasharray = `${slicePercent * circumference} ${circumference}`;
              const strokeDashoffset = -accumulatedPercent * circumference;
              accumulatedPercent += slicePercent;

              const isHovered = hoveredIndex === idx;
              const color = PALETTE[idx % PALETTE.length];

              return (
                <circle
                  key={item.name}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="transparent"
                  stroke={color}
                  strokeWidth={isHovered ? strokeWidth + 4 : strokeWidth}
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  className="cursor-pointer transition-all duration-300"
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                />
              );
            })}
          </svg>

          {/* Center Callout */}
          <div className="pointer-events-none absolute flex flex-col items-center justify-center text-center">
            {hoveredIndex !== null && distribution[hoveredIndex] ? (
              <>
                <span className="max-w-[80px] truncate text-[11px] font-bold text-slate-200">
                  {distribution[hoveredIndex]!.name}
                </span>
                <span className="font-mono text-base font-extrabold text-white">
                  {distribution[hoveredIndex]!.percentage}%
                </span>
                <span className="text-[10px] text-slate-400">
                  {distribution[hoveredIndex]!.value} posts
                </span>
              </>
            ) : (
              <>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Kafka Queue
                </span>
                <span className="font-mono text-xl font-extrabold text-emerald-400">
                  {data.totalPublished}
                </span>
                <span className="text-[10px] text-slate-400">Total Posts</span>
              </>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
          {distribution.map((item, idx) => {
            const color = PALETTE[idx % PALETTE.length];
            const isHovered = hoveredIndex === idx;

            return (
              <div
                key={item.name}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                className={`flex cursor-pointer items-center justify-between rounded-lg p-1.5 transition-all ${
                  isHovered ? 'bg-slate-800/80 ring-1 ring-slate-700' : 'hover:bg-slate-800/30'
                }`}
              >
                <div className="flex items-center space-x-2 truncate pr-2">
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate text-xs font-medium text-slate-300">
                    {item.name}
                  </span>
                </div>
                <div className="flex items-center space-x-1.5 text-right font-mono text-xs">
                  <span className="font-bold text-white">{item.percentage}%</span>
                  <span className="text-[11px] text-slate-400">({item.value})</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
