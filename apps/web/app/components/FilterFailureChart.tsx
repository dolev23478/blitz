'use client';

import React from 'react';
import { AlertTriangle, Filter, ShieldX } from 'lucide-react';
import type { ChannelFailureItem } from '@blitz/shared';

interface FilterFailureChartProps {
  topFailingChannels: ChannelFailureItem[];
  totalRejected: number;
}

export function FilterFailureChart({
  topFailingChannels,
  totalRejected,
}: FilterFailureChartProps) {
  const maxRejected = Math.max(
    ...topFailingChannels.map((c) => c.rejectedCount),
    1,
  );

  return (
    <div className="chart-panel">
      <div className="chart-panel-header">
        <div>
          <div className="chart-title-wrap">
            <AlertTriangle size={18} className="chart-icon text-amber" />
            <h3>Keyword Filter Rejection Statistics</h3>
          </div>
          <p className="chart-subtitle">
            Channels that fail threat keyword criteria most often (deemed unworthy for Kafka)
          </p>
        </div>
        <div className="chart-pill warning">
          <ShieldX size={12} />
          <span>{totalRejected} Total Rejections</span>
        </div>
      </div>

      <div className="chart-content">
        {topFailingChannels.length === 0 ? (
          <div className="empty-hint">No filter rejections recorded yet.</div>
        ) : (
          <div className="bar-chart-list">
            {topFailingChannels.map((item) => {
              const barWidth = Math.round((item.rejectedCount / maxRejected) * 100);
              const isSevere = item.failureRate > 50;

              return (
                <div key={item.channel} className="bar-row">
                  <div className="bar-info-row">
                    <div className="bar-channel-name">
                      <span className="source-tag">{item.source}</span>
                      <strong title={item.channel}>{item.channel}</strong>
                    </div>
                    <div className="bar-stats">
                      <span className="rejected-stat">
                        <strong>{item.rejectedCount}</strong> rejected / {item.totalFetched} fetched
                      </span>
                      <span className={`failure-pill ${isSevere ? 'high' : 'medium'}`}>
                        {item.failureRate}% failure rate
                      </span>
                    </div>
                  </div>

                  <div className="bar-track">
                    <div
                      className={`bar-fill ${isSevere ? 'severe' : ''}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
