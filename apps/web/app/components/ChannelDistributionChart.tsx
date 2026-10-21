'use client';

import React, { useState } from 'react';
import { PieChart, Radio, Send } from 'lucide-react';
import type { ChannelDistributionItem } from '@blitz/shared';

interface ChannelDistributionChartProps {
  distribution: ChannelDistributionItem[];
  totalPublished: number;
}

const PALETTE = [
  '#38bdf8', // Sky 400
  '#818cf8', // Indigo 400
  '#34d399', // Emerald 400
  '#f472b6', // Pink 400
  '#fbbf24', // Amber 400
  '#a78bfa', // Violet 400
  '#2dd4bf', // Teal 400
  '#fb923c', // Orange 400
];

export function ChannelDistributionChart({
  distribution,
  totalPublished,
}: ChannelDistributionChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const items = distribution.length > 0 ? distribution : [];

  // Calculate SVG Pie Segments
  let cumulativePercent = 0;
  const segments = items.map((item, idx) => {
    const startAngle = cumulativePercent * 3.6;
    cumulativePercent += item.percentage;
    const endAngle = cumulativePercent * 3.6;
    return {
      ...item,
      color: PALETTE[idx % PALETTE.length],
      startAngle,
      endAngle,
    };
  });

  function getCoordinatesForPercent(percent: number, radius = 80) {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [100 + radius * x, 100 + radius * y];
  }

  return (
    <div className="chart-panel">
      <div className="chart-panel-header">
        <div>
          <div className="chart-title-wrap">
            <PieChart size={18} className="chart-icon text-sky" />
            <h3>Channel Emission Distribution</h3>
          </div>
          <p className="chart-subtitle">
            Breakdown of channels that successfully stream posts to Kafka
          </p>
        </div>
        <div className="chart-pill">
          <Send size={12} />
          <span>{totalPublished} Emitted Posts</span>
        </div>
      </div>

      <div className="chart-content donut-layout">
        <div className="donut-svg-wrap">
          <svg viewBox="0 0 200 200" className="donut-svg">
            {segments.length === 0 ? (
              <circle
                cx="100"
                cy="100"
                r="70"
                fill="none"
                stroke="rgba(148, 163, 184, 0.15)"
                strokeWidth="26"
              />
            ) : (
              segments.map((seg, idx) => {
                const isHovered = hoveredIdx === idx;
                const strokeWidth = isHovered ? 28 : 22;
                const radius = 70;
                const circumference = 2 * Math.PI * radius;
                const strokeDasharray = `${(seg.percentage / 100) * circumference} ${circumference}`;
                const initialOffset = (seg.startAngle / 360) * circumference;

                return (
                  <circle
                    key={seg.name}
                    cx="100"
                    cy="100"
                    r={radius}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={strokeDasharray}
                    strokeDashoffset={-initialOffset}
                    transform="rotate(-90 100 100)"
                    style={{
                      transition: 'all 0.3s ease',
                      cursor: 'pointer',
                      filter: isHovered ? `drop-shadow(0 0 8px ${seg.color})` : 'none',
                    }}
                    onMouseEnter={() => setHoveredIdx(idx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  />
                );
              })
            )}

            {/* Inner Center Label */}
            <circle cx="100" cy="100" r="54" fill="#0b1322" />
            <text
              x="100"
              y="94"
              textAnchor="middle"
              fill="#edf6ff"
              fontSize="20"
              fontWeight="700"
            >
              {hoveredIdx !== null && segments[hoveredIdx]
                ? `${segments[hoveredIdx].percentage}%`
                : totalPublished}
            </text>
            <text
              x="100"
              y="112"
              textAnchor="middle"
              fill="#94a3b8"
              fontSize="10"
              fontWeight="500"
            >
              {hoveredIdx !== null && segments[hoveredIdx]
                ? segments[hoveredIdx].name.slice(0, 16)
                : 'TOTAL POSTS'}
            </text>
          </svg>
        </div>

        {/* Legend & Channel Breakdown List */}
        <div className="donut-legend-list">
          {items.length === 0 ? (
            <div className="empty-hint">No channel emissions recorded yet.</div>
          ) : (
            items.map((item, idx) => {
              const color = PALETTE[idx % PALETTE.length];
              const isHovered = hoveredIdx === idx;
              return (
                <div
                  key={item.name}
                  className={`legend-row ${isHovered ? 'hovered' : ''}`}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  <div className="legend-left">
                    <span className="legend-color-dot" style={{ backgroundColor: color }} />
                    <span className="legend-name" title={item.name}>
                      {item.name}
                    </span>
                  </div>
                  <div className="legend-right">
                    <span className="legend-count">{item.value} posts</span>
                    <span className="legend-pct" style={{ color }}>
                      {item.percentage}%
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
