'use client';

import React, { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Filter,
  Radio,
  Search,
  XCircle,
} from 'lucide-react';
import type { KafkaStreamEvent } from '@blitz/shared';

interface LiveTelemetryStreamProps {
  events: KafkaStreamEvent[];
}

export function LiveTelemetryStream({ events }: LiveTelemetryStreamProps) {
  const [filterType, setFilterType] = useState<'all' | 'published' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = events.filter((ev) => {
    if (filterType === 'published' && ev.type !== 'kafka_published') return false;
    if (filterType === 'rejected' && ev.type !== 'filter_rejected') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchContent = ev.content.toLowerCase().includes(q);
      const matchChannel = ev.channel.toLowerCase().includes(q);
      const matchSource = ev.source.toLowerCase().includes(q);
      return matchContent || matchChannel || matchSource;
    }

    return true;
  });

  return (
    <div className="telemetry-panel">
      <div className="telemetry-header">
        <div className="telemetry-title-block">
          <h3>Live Telemetry Stream</h3>
          <p>Real-time Kafka queue emissions & keyword filter decisions</p>
        </div>

        <div className="telemetry-toolbar">
          <div className="filter-pill-group">
            <button
              type="button"
              className={`pill-btn ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              All Events ({events.length})
            </button>
            <button
              type="button"
              className={`pill-btn published ${filterType === 'published' ? 'active' : ''}`}
              onClick={() => setFilterType('published')}
            >
              Emitted to Kafka
            </button>
            <button
              type="button"
              className={`pill-btn rejected ${filterType === 'rejected' ? 'active' : ''}`}
              onClick={() => setFilterType('rejected')}
            >
              Rejected
            </button>
          </div>

          <div className="search-input-wrap">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="Search content, channels..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
      </div>

      <div className="telemetry-list-wrap">
        {filtered.length === 0 ? (
          <div className="empty-hint">No events match your current filter.</div>
        ) : (
          <div className="telemetry-items">
            {filtered.map((ev) => {
              const isPublished = ev.type === 'kafka_published';
              const timeStr = new Date(ev.timestamp).toLocaleTimeString();

              return (
                <div
                  key={ev.id}
                  className={`telemetry-item ${isPublished ? 'item-published' : 'item-rejected'}`}
                >
                  <div className="item-icon-col">
                    {isPublished ? (
                      <CheckCircle2 size={18} className="text-good" />
                    ) : (
                      <XCircle size={18} className="text-danger" />
                    )}
                  </div>

                  <div className="item-main">
                    <div className="item-header">
                      <div className="item-channel-info">
                        <span className="source-tag">{ev.source}</span>
                        <strong>{ev.channel}</strong>
                        {isPublished && ev.topic && (
                          <span className="topic-tag">topic: {ev.topic}</span>
                        )}
                        {isPublished && ev.language && (
                          <span className="lang-tag">lang: {ev.language}</span>
                        )}
                      </div>

                      <div className="item-meta">
                        <span className="time-tag">
                          <Clock size={12} /> {timeStr}
                        </span>
                        <span
                          className={`status-chip ${isPublished ? 'chip-published' : 'chip-rejected'}`}
                        >
                          {isPublished ? 'KAFKA EMITTED' : 'FILTER REJECTED'}
                        </span>
                      </div>
                    </div>

                    <div className="item-content">{ev.content}</div>

                    <div className="item-footer">
                      {isPublished && ev.termsMatched && ev.termsMatched.length > 0 && (
                        <div className="matched-terms-row">
                          <span className="terms-label">Keywords matched:</span>
                          {ev.termsMatched.map((term, i) => (
                            <span key={`${term}-${i}`} className="term-chip">
                              {term}
                            </span>
                          ))}
                        </div>
                      )}

                      {!isPublished && (
                        <div className="rejection-reason">
                          <strong>Rejection reason:</strong> {ev.reason}
                        </div>
                      )}
                    </div>
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
