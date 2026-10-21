'use client';

import React from 'react';
import {
  Activity,
  BarChart3,
  Layers,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';

export type ActiveTab = 'analytics' | 'threats' | 'unified';

interface HeaderProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  connected: boolean;
  isPaused: boolean;
  onTogglePause: () => void;
  onRefresh: () => void;
  totalPublished: number;
  totalRejected: number;
  threatPostsCount: number;
}

export function Header({
  activeTab,
  onSelectTab,
  connected,
  isPaused,
  onTogglePause,
  onRefresh,
  totalPublished,
  totalRejected,
  threatPostsCount,
}: HeaderProps) {
  return (
    <header className="app-header">
      <div className="header-brand-row">
        <div className="brand-title">
          <div className="brand-badge">BLITZ // MONITOR</div>
          <h1>Stream Analytics & Threat Intelligence</h1>
          <p>
            Real-time Kafka stream metrics, keyword filter telemetry & live intelligence
            feed
          </p>
        </div>

        <div className="header-controls">
          <div className={`status-pill ${connected ? 'connected' : 'disconnected'}`}>
            <span className={`pulse-dot ${connected ? 'active' : ''}`} />
            <span>{connected ? 'LIVE SSE CONNECTED' : 'CONNECTING TO STREAM...'}</span>
          </div>

          <button
            type="button"
            className="action-btn"
            onClick={onTogglePause}
            title={isPaused ? 'Resume live feed updates' : 'Pause live feed updates'}
          >
            {isPaused ? <Play size={14} /> : <Pause size={14} />}
            <span>{isPaused ? 'RESUME STREAM' : 'PAUSE'}</span>
          </button>

          <button
            type="button"
            className="action-btn icon-only"
            onClick={onRefresh}
            title="Refresh snapshot metrics"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="header-tabs-bar">
        <nav className="tab-group">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => onSelectTab('analytics')}
          >
            <BarChart3 size={16} />
            <span>Kafka Analytics & Telemetry</span>
            <span className="tab-count">{totalPublished + totalRejected}</span>
          </button>

          <button
            type="button"
            className={`tab-btn ${activeTab === 'threats' ? 'active' : ''}`}
            onClick={() => onSelectTab('threats')}
          >
            <ShieldAlert size={16} />
            <span>Filtered Threat Feed</span>
            <span className="tab-count threat">{threatPostsCount}</span>
          </button>

          <button
            type="button"
            className={`tab-btn ${activeTab === 'unified' ? 'active' : ''}`}
            onClick={() => onSelectTab('unified')}
          >
            <Layers size={16} />
            <span>Unified Intelligence View</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
