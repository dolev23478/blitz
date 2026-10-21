import { Controller, Get, Inject, Sse } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Public } from '../common/api-key.guard.js';
import { FilteredPostsService } from '../events/filtered-posts.service.js';
import type { FilteredPost, FilteredPostEvent } from '../types.js';
import { MetaService } from './meta.service.js';

@Controller()
export class MetaController {
  constructor(
    @Inject(MetaService) private readonly meta: MetaService,
    @Inject(FilteredPostsService) private readonly filtered: FilteredPostsService,
  ) {}

  @Public()
  @Get()
  rootPage(): string {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Blitz Front Page</title>
    <style>
      :root {
        --bg: #09111b;
        --panel: rgba(15, 23, 42, 0.9);
        --panel-border: rgba(148, 163, 184, 0.18);
        --text: #edf6ff;
        --muted: #a6b5c9;
        --danger: #ef4444;
        --warning: #f59e0b;
        --good: #34d399;
        --highlight: rgba(239, 68, 68, 0.2);
      }

      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background: radial-gradient(circle at top,#1b2a42 0%, var(--bg) 35%); color: var(--text); }
      body { min-height: 100vh; }
      main { max-width: 1200px; margin: 0 auto; padding: 32px 20px 80px; }
      .header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
      .header h1 { margin: 0; font-size: clamp(2rem, 4vw, 3rem); }
      .header p { margin: 8px 0 0; color: var(--muted); }
      .status { padding: 8px 12px; border-radius: 999px; border: 1px solid var(--panel-border); background: rgba(15, 23, 42, 0.8); color: var(--muted); font-size: 0.8rem; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 18px; }
      .card { border: 1px solid var(--panel-border); background: var(--panel); border-radius: 18px; overflow: hidden; box-shadow: 0 18px 48px rgba(2,6,23,0.28); }
      .meta { display: flex; justify-content: space-between; gap: 12px; padding: 16px 18px 10px; border-bottom: 1px solid var(--panel-border); }
      .channel { font-weight: 700; }
      .time { color: var(--muted); font-size: 0.8rem; }
      .body { padding: 18px; line-height: 1.6; color: var(--text); }
      .body mark { background: var(--highlight); color: #ffe7e7; padding: 2px 4px; border-radius: 5px; border: 1px solid rgba(239,68,68,0.45); font-weight: 700; }
      .footer { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 18px 18px; }
      .badge, .keyword { display: inline-flex; padding: 6px 10px; border-radius: 999px; font-size: 0.75rem; border: 1px solid var(--panel-border); }
      .badge.high { background: rgba(239,68,68,0.15); color: #fecaca; border-color: rgba(239,68,68,0.35); }
      .badge.medium { background: rgba(245,158,11,0.12); color: #fcd34d; border-color: rgba(245,158,11,0.35); }
      .badge.low { background: rgba(52,211,153,0.12); color: #bbf7d0; border-color: rgba(52,211,153,0.38); }
      .keyword { background: rgba(96,165,250,0.1); color: #dbeafe; }
      .empty { border: 1px dashed var(--panel-border); border-radius: 18px; padding: 24px; color: var(--muted); text-align: center; background: rgba(15,23,42,0.35); }
    </style>
  </head>
  <body>
    <main>
      <div class="header">
        <div>
          <h1>Front Page</h1>
          <p>All posts that passed the filter</p>
        </div>
        <div id="live-status" class="status">Connecting…</div>
      </div>
      <div id="posts" class="grid"></div>
    </main>

    <script>
      const postsEl = document.getElementById('posts');
      const statusEl = document.getElementById('live-status');
      const state = { posts: [] };

      function renderHighlight(text, matches = []) {
        if (!matches.length) return text;
        const sorted = [...matches].sort((a, b) => a.start - b.start);
        const nodes = [];
        let cursor = 0;

        sorted.forEach((match) => {
          const start = Math.max(0, Number(match.start) || 0);
          const end = Math.min(text.length, Number(match.end) || text.length);
          if (start > cursor) nodes.push(document.createTextNode(text.slice(cursor, start)));
          if (end > start) {
            const mark = document.createElement('mark');
            mark.textContent = text.slice(start, end);
            nodes.push(mark);
            cursor = end;
          }
        });

        if (cursor < text.length) nodes.push(document.createTextNode(text.slice(cursor)));

        return nodes;
      }

      function formatTime(value) {
        return new Date(value).toLocaleString();
      }

      function render() {
        const posts = state.posts;
        if (!posts.length) {
          postsEl.innerHTML = '<div class="empty">No filtered posts yet.</div>';
          return;
        }

        postsEl.innerHTML = posts.map((post) => {
          const keywords = (post.matches || []).map((match) => '<span class="keyword">' + match.term + '</span>').join('');
          return '<article class="card">' +
            '<div class="meta">' +
              '<div class="channel">' + String(post.channel || post.source || 'unknown') + '</div>' +
              '<div class="time">' + formatTime(post.createdAt) + '</div>' +
            '</div>' +
            '<div class="body">' + renderHighlight(post.text || '', post.matches || []) + '</div>' +
            '<div class="footer">' +
              '<span class="badge ' + (post.severity || 'medium') + '">' + (post.severity || 'medium') + '</span>' +
              keywords +
            '</div>' +
          '</article>';
        }).join('');
      }

      function addPost(post) {
        state.posts = [post, ...state.posts].slice(0, 50);
        render();
      }

      const source = new EventSource('/api/posts/stream');
      source.onopen = () => {
        statusEl.textContent = 'Live stream connected';
      };
      source.onerror = () => {
        statusEl.textContent = 'Connecting…';
      };
      source.addEventListener('filtered-post', (event) => {
        try {
          const payload = JSON.parse(event.data);
          const post = payload.payload || payload;
          if (post && post.text) addPost(post);
        } catch (error) {
          console.error('invalid SSE payload', error);
        }
      });

      fetch('/api/posts')
        .then((response) => response.ok ? response.json() : [])
        .then((items) => {
          state.posts = items || [];
          render();
        })
        .catch(() => {
          state.posts = [];
          render();
        });
    </script>
  </body>
</html>`;
  }

  @Public()
  @Get('health')
  health() {
    return this.meta.health();
  }

  @Public()
  @Get('posts')
  listPosts(): FilteredPost[] {
    return this.filtered.getRecent();
  }

  @Public()
  @Sse('posts/stream')
  streamPosts(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const unsubscribe = this.filtered.subscribe((event: FilteredPostEvent) => {
        subscriber.next({
          data: JSON.stringify(event),
        } as MessageEvent);
      });

      return () => unsubscribe();
    }).pipe(
      map((event) => ({
        ...event,
        type: 'filtered-post',
      })),
    );
  }
}
