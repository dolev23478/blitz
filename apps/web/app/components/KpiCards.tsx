'use client';

import React from 'react';
import {
  CheckCircle2,
  Radio,
  Share2,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import type { KafkaAnalyticsSummary } from '@blitz/shared';

interface KpiCardsProps {
  summary: KafkaAnalyticsSummary;
}

export function KpiCards({ summary }: KpiCardsProps) {
  const topPub = summary.topPublishingChannels?.[0];
  const topFail = summary.topFailingChannels?.[0];

  return (
    <section className="kpi-grid">
      {/* 1. Total Streamed to Kafka */}
      <div className="kpi-card published">
        <div className="kpi-header">
          <span className="kpi-label">STREAMED TO KAFKA</span>
          <div className="kpi-icon-wrap published">
            <CheckCircle2 size={18} />
          </div>
        </div>
        <div className="kpi-value">{summary.totalPublished.toLocaleString()}</div>
        <div className="kpi-meta">
          <span className="badge positive">
            <TrendingUp size={12} /> {summary.overallAcceptanceRate}% pass
          </span>
          <span className="kpi-hint">
            Top: <strong>{topPub?.channel ?? 'None'}</strong> ({topPub?.count ?? 0})
          </span>
        </div>
      </div>

      {/* 2. Filtered / Rejected Posts */}
      <div className="kpi-card rejected">
        <div className="kpi-header">
          <span className="kpi-label">FILTER REJECTIONS</span>
          <div className="kpi-icon-wrap rejected">
            <XCircle size={18} />
          </div>
        </div>
        <div className="kpi-value">{summary.totalRejected.toLocaleString()}</div>
        <div className="kpi-meta">
          <span className="badge warning">{summary.overallRejectionRate}% rejected</span>
          <span className="kpi-hint">
            Most rejects: <strong>{topFail?.channel ?? 'None'}</strong> ({topFail?.rejectedCount ?? 0})
          </span>
        </div>
      </div>

      {/* 3. Ingestion Pipeline Sources */}
      <div className="kpi-card info">
        <div className="kpi-header">
          <span className="kpi-label">MONITORED CHANNELS</span>
          <div className="kpi-icon-wrap info">
            <Radio size={18} />
          </div>
        </div>
        <div className="kpi-value">{Object.keys(summary.channels).length}</div>
        <div className="kpi-meta">
          <span className="badge neutral">Telegram & X Scraper</span>
          <span className="kpi-hint">Active threat listeners</span>
        </div>
      </div>

      {/* 4. Total Pipeline Throughput */}
      <div className="kpi-card purple">
        <div className="kpi-header">
          <span className="kpi-label">TOTAL PROCESSED</span>
          <div className="kpi-icon-wrap purple">
            <Share2 size={18} />
          </div>
        </div>
        <div className="kpi-value">{summary.totalProcessed.toLocaleString()}</div>
        <div className="kpi-meta">
          <div className="progress-bar-wrap">
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.min(100, Math.max(0, summary.overallAcceptanceRate))}%` }}
            />
          </div>
          <span className="kpi-hint">{summary.overallAcceptanceRate}% qualifying</span>
        </div>
      </div>
    </section>
  );
}
