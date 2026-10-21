'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { FilteredPost, WarningMatch } from '@blitz/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const initialPosts: FilteredPost[] = [
  {
    id: 'demo-1',
    source: 'telegram',
    channel: 'alerts-channel',
    text: 'We are preparing explosives near the station and will strike before sunrise.',
    createdAt: new Date(Date.now() - 120000).toISOString(),
    severity: 'high',
    matches: [
      { term: 'explosives', normalized: 'explosives', start: 19, end: 29, category: 'weapon' },
      { term: 'strike', normalized: 'strike', start: 57, end: 63, category: 'violence' },
      { term: 'sunrise', normalized: 'sunrise', start: 75, end: 82, category: 'threat' },
    ],
  },
  {
    id: 'demo-2',
    source: 'x',
    channel: 'watchdesk',
    text: 'The team is moving a drone toward the military checkpoint.',
    createdAt: new Date(Date.now() - 300000).toISOString(),
    severity: 'medium',
    matches: [
      { term: 'drone', normalized: 'drone', start: 19, end: 24, category: 'weapon' },
      { term: 'military', normalized: 'military', start: 41, end: 49, category: 'threat' },
    ],
  },
];

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

function renderHighlightedText(text: string, matches: WarningMatch[]) {
  if (!matches.length) return text;

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
      nodes.push(<mark key={`mark-${index}`}>{text.slice(start, end)}</mark>);
      cursor = end;
    }
  });

  if (cursor < text.length) {
    nodes.push(<span key="tail">{text.slice(cursor)}</span>);
  }

  return nodes;
}

export default function Page() {
  const [posts, setPosts] = useState<FilteredPost[]>(initialPosts);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const loadInitial = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/posts`, { cache: 'no-store' });
        if (!response.ok) {
          return;
        }

        const items = (await response.json()) as FilteredPost[];
        if (Array.isArray(items) && items.length) {
          setPosts(items.slice(0, 50));
        }
      } catch {
        // backend may not be running yet
      }
    };

    void loadInitial();

    const source = new EventSource(`${API_BASE}/api/posts/stream`);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener('filtered-post', (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as { payload?: FilteredPost };
        const post = payload.payload ?? payload;
        if (!post || !post.text) {
          return;
        }

        setPosts((current) => [post, ...current].slice(0, 50));
      } catch {
        // ignore malformed SSE payloads until backend is stable
      }
    });

    return () => source.close();
  }, []);

  const totalMatches = useMemo(
    () => posts.reduce((sum, post) => sum + (post.matches?.length ?? 0), 0),
    [posts],
  );

  return (
    <main>
      <header className="page-header">
        <div>
          <h1>Front Page</h1>
          <p>Live posts that crossed the filter</p>
        </div>
        <div className="status-pill">{connected ? 'Live stream connected' : 'Waiting for backend'}</div>
      </header>

      <div className="page-header" style={{ marginTop: 0, marginBottom: 22 }}>
        <div className="status-pill">Total posts: {posts.length}</div>
        <div className="status-pill">Warning hits: {totalMatches}</div>
      </div>

      <section className="posts-grid">
        {posts.length === 0 ? (
          <div className="empty-state">No filtered posts yet.</div>
        ) : (
          posts.map((post) => (
            <article className="post-card" key={post.id}>
              <div className="post-card-header">
                <div className="post-channel">{post.channel}</div>
                <div className="post-time">{formatTime(post.createdAt)}</div>
              </div>

              <div className="post-body">{renderHighlightedText(post.text, post.matches ?? [])}</div>

              <div className="post-footer">
                <span className={`severity-tag ${post.severity}`}>{post.severity}</span>
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
    </main>
  );
}
