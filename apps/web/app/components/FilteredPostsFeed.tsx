'use client';

import React, { useMemo, useState, type ReactNode } from 'react';
import { Clock, Filter, Search, ShieldAlert } from 'lucide-react';
import type { FilteredPost, WarningMatch } from '@blitz/shared';

interface FilteredPostsFeedProps {
  posts: FilteredPost[];
}

function formatTime(value: string) {
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return value;
  }
}

function renderHighlightedText(text: string, matches: WarningMatch[]) {
  if (!matches || !matches.length) return text;

  const sorted = [...matches].sort((a, b) => a.start - b.start);
  const nodes: Array<ReactNode> = [];
  let cursor = 0;

  sorted.forEach((match, index) => {
    const start = Math.max(0, match.start);
    const end = Math.min(text.length, match.end);

    if (start > cursor) {
      nodes.push(<span key={`plain-${index}`}>{text.slice(cursor, start)}</span>);
    }

    if (end > start) {
      nodes.push(
        <mark key={`mark-${index}`} className={`mark-${match.category || 'threat'}`}>
          {text.slice(start, end)}
        </mark>,
      );
      cursor = end;
    }
  });

  if (cursor < text.length) {
    nodes.push(<span key="tail">{text.slice(cursor)}</span>);
  }

  return nodes;
}

export function FilteredPostsFeed({ posts }: FilteredPostsFeedProps) {
  const [severityFilter, setSeverityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    return posts.filter((post) => {
      if (severityFilter !== 'all' && post.severity !== severityFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const textMatch = post.text.toLowerCase().includes(q);
        const chanMatch = post.channel.toLowerCase().includes(q);
        return textMatch || chanMatch;
      }
      return true;
    });
  }, [posts, severityFilter, searchQuery]);

  return (
    <div className="threats-feed-container">
      <div className="threats-toolbar">
        <div>
          <h2 className="section-title">
            <ShieldAlert size={20} className="text-danger inline-icon" />
            Live Posts Crossing Keyword Filter
          </h2>
          <p className="section-desc">
            Posts classified as worthy of Kafka dispatch based on high-confidence threat terminology
          </p>
        </div>

        <div className="threats-filters">
          <div className="filter-pill-group">
            <button
              type="button"
              className={`pill-btn ${severityFilter === 'all' ? 'active' : ''}`}
              onClick={() => setSeverityFilter('all')}
            >
              All ({posts.length})
            </button>
            <button
              type="button"
              className={`pill-btn severity-high ${severityFilter === 'high' ? 'active' : ''}`}
              onClick={() => setSeverityFilter('high')}
            >
              High
            </button>
            <button
              type="button"
              className={`pill-btn severity-med ${severityFilter === 'medium' ? 'active' : ''}`}
              onClick={() => setSeverityFilter('medium')}
            >
              Medium
            </button>
          </div>

          <div className="search-input-wrap">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              placeholder="Search post text..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
      </div>

      <section className="posts-grid">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <ShieldAlert size={32} className="text-muted" style={{ marginBottom: 12 }} />
            <div>No threat intelligence posts match current criteria.</div>
          </div>
        ) : (
          filtered.map((post) => (
            <article className={`post-card severity-border-${post.severity}`} key={post.id}>
              <div className="post-card-header">
                <div className="post-channel">
                  <span className="source-tag">{post.source}</span>
                  <strong>{post.channel}</strong>
                </div>
                <div className="post-time">
                  <Clock size={12} className="inline-icon" />
                  {formatTime(post.createdAt)}
                </div>
              </div>

              <div className="post-body">
                {renderHighlightedText(post.text, post.matches ?? [])}
              </div>

              <div className="post-footer">
                <span className={`severity-tag ${post.severity}`}>{post.severity.toUpperCase()}</span>
                {(post.matches ?? []).map((match, index) => (
                  <span key={`${match.term}-${index}`} className="keyword-tag">
                    {match.term}
                  </span>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
